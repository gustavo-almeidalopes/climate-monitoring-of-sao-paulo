from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.ml.features import FEATURE_COLUMNS

if TYPE_CHECKING:
    import numpy as np
    import pandas as pd

BUNDLE_FORMAT = 2
_SKLEARN_AVAILABLE: bool | None = None


def sklearn_available() -> bool:
    global _SKLEARN_AVAILABLE
    if _SKLEARN_AVAILABLE is None:
        try:
            import sklearn  # noqa: F401

            _SKLEARN_AVAILABLE = True
        except ImportError:
            _SKLEARN_AVAILABLE = False
    return _SKLEARN_AVAILABLE


def _classifier():
    from sklearn.ensemble import HistGradientBoostingClassifier

    return HistGradientBoostingClassifier(
        max_iter=500,
        learning_rate=0.05,
        max_leaf_nodes=31,
        min_samples_leaf=40,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=30,
        random_state=42,
    )


def _regressor():
    from sklearn.ensemble import HistGradientBoostingRegressor

    # Poisson: alvo não-negativo, assimétrico, com muitos zeros (chuva acumulada).
    return HistGradientBoostingRegressor(
        loss="poisson",
        max_iter=500,
        learning_rate=0.05,
        max_leaf_nodes=31,
        min_samples_leaf=40,
        l2_regularization=1.0,
        early_stopping=True,
        validation_fraction=0.1,
        n_iter_no_change=30,
        random_state=42,
    )


def _time_split(data: "pd.DataFrame", fraction: float, embargo_hours: int):
    """Divide cronologicamente: tudo antes do corte é treino; após corte + embargo é teste."""
    times = data["observed_at"]
    cutoff = times.quantile(fraction)
    first = data[times < cutoff]
    second = data[times >= cutoff + timedelta(hours=embargo_hours)]
    return first, second


def _best_f1_threshold(y_true: "np.ndarray", proba: "np.ndarray") -> float:
    import numpy as np
    from sklearn.metrics import precision_recall_curve

    if y_true.sum() == 0:
        return 0.5
    precision, recall, thresholds = precision_recall_curve(y_true, proba)
    f1 = 2 * precision * recall / np.clip(precision + recall, 1e-9, None)
    best = int(np.nanargmax(f1[:-1])) if len(thresholds) else 0
    return float(thresholds[best]) if len(thresholds) else 0.5


def _binary_metrics(y_true: "np.ndarray", y_pred: "np.ndarray") -> dict[str, float]:
    from sklearn.metrics import f1_score, precision_score, recall_score

    return {
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
    }


class FloodRiskModel:
    """Modelo de nowcasting de chuva forte para as regiões de SP.

    Composto por dois estimadores HistGradientBoosting (lidam nativamente com valores ausentes):
      - classificador: P(chuva acumulada nas próximas H horas >= limiar de chuva forte)
      - regressor (Poisson): chuva esperada (mm) nas próximas H horas

    Avaliação honesta: divisão temporal (treino no passado, teste no período mais recente,
    com embargo entre eles) e comparação contra baselines de climatologia e persistência.
    Depois de avaliado, o modelo final é re-treinado com todo o histórico.
    """

    def __init__(self, model_path: Path) -> None:
        self.model_path = Path(model_path)
        self._classifier: Any = None
        self._regressor: Any = None
        self._metadata: dict = {}

    @property
    def metadata_path(self) -> Path:
        return self.model_path.with_suffix(".json")

    @property
    def is_loaded(self) -> bool:
        return self._classifier is not None and self._regressor is not None

    @property
    def metadata(self) -> dict:
        return self._metadata

    @property
    def train_metrics(self) -> dict:
        return self._metadata.get("metrics", {})

    @property
    def feature_importance(self) -> dict[str, float]:
        return self._metadata.get("feature_importance", {})

    def load(self) -> bool:
        if not sklearn_available() or not self.model_path.exists():
            return False
        try:
            import joblib

            bundle = joblib.load(self.model_path)
        except Exception:
            return False
        if not isinstance(bundle, dict) or bundle.get("format") != BUNDLE_FORMAT:
            # Artefato de versão antiga (labels derivados das próprias features) — ignorado.
            return False
        if bundle.get("feature_columns") != FEATURE_COLUMNS:
            return False
        self._classifier = bundle["classifier"]
        self._regressor = bundle["regressor"]
        self._metadata = bundle.get("metadata", {})
        return True

    def train(
        self,
        data: "pd.DataFrame",
        *,
        horizon_hours: int,
        heavy_rain_mm: float,
        data_sources: list[str] | None = None,
    ) -> dict:
        """Avalia com divisão temporal, re-treina com todos os dados e persiste em disco."""
        if not sklearn_available():
            raise RuntimeError("scikit-learn não está instalado.")

        import joblib
        import numpy as np
        from sklearn.inspection import permutation_importance
        from sklearn.metrics import (
            average_precision_score,
            brier_score_loss,
            mean_absolute_error,
            mean_squared_error,
            roc_auc_score,
        )

        data = data.sort_values("observed_at").reset_index(drop=True)
        embargo = horizon_hours + 24
        train_df, test_df = _time_split(data, 0.8, embargo)
        fit_df, val_df = _time_split(train_df, 0.85, embargo)

        for name, part in (("treino", fit_df), ("validação", val_df), ("teste", test_df)):
            if part.empty or part["target_heavy"].sum() < 3:
                raise RuntimeError(
                    f"Conjunto de {name} sem eventos de chuva forte suficientes "
                    f"(limiar {heavy_rain_mm} mm/{horizon_hours}h). Colete mais anos de histórico."
                )

        def xy(part: "pd.DataFrame"):
            return (
                part[FEATURE_COLUMNS].to_numpy(dtype=float),
                part["target_heavy"].to_numpy(dtype=int),
                part["target_rain_mm"].to_numpy(dtype=float),
            )

        X_fit, y_fit, _ = xy(fit_df)
        X_val, y_val, _ = xy(val_df)
        X_train, y_train, r_train = xy(train_df)
        X_test, y_test, r_test = xy(test_df)

        # 1) Limiar de decisão escolhido na validação (nunca no teste).
        clf_val = _classifier().fit(X_fit, y_fit)
        decision_threshold = _best_f1_threshold(y_val, clf_val.predict_proba(X_val)[:, 1])

        # 2) Avaliação no período mais recente, nunca visto no treino.
        clf = _classifier().fit(X_train, y_train)
        reg = _regressor().fit(X_train, r_train)
        proba = clf.predict_proba(X_test)[:, 1]
        expected = np.clip(reg.predict(X_test), 0.0, None)

        climatology = float(y_train.mean())
        brier = float(brier_score_loss(y_test, proba))
        brier_clim = float(brier_score_loss(y_test, np.full_like(proba, climatology)))

        persistence_score = test_df["rain_3h"].to_numpy(dtype=float)
        persistence_mm = test_df["rain_3h"].to_numpy(dtype=float) * (horizon_hours / 3.0)
        persistence_bin = (persistence_mm >= heavy_rain_mm).astype(int)

        metrics = {
            "roc_auc": float(roc_auc_score(y_test, proba)),
            "pr_auc": float(average_precision_score(y_test, proba)),
            "brier": brier,
            "brier_skill_vs_climatology": float(1.0 - brier / brier_clim) if brier_clim > 0 else 0.0,
            "decision_threshold": decision_threshold,
            **{f"{k}_heavy": v for k, v in _binary_metrics(y_test, (proba >= decision_threshold).astype(int)).items()},
            "rain_mae_mm": float(mean_absolute_error(r_test, expected)),
            "rain_rmse_mm": float(np.sqrt(mean_squared_error(r_test, expected))),
            "baseline": {
                "climatology_brier": brier_clim,
                "persistence_roc_auc": float(roc_auc_score(y_test, persistence_score)),
                "persistence_pr_auc": float(average_precision_score(y_test, persistence_score)),
                **{f"persistence_{k}_heavy": v for k, v in _binary_metrics(y_test, persistence_bin).items()},
                "persistence_rain_mae_mm": float(mean_absolute_error(r_test, persistence_mm)),
                "zero_rain_mae_mm": float(mean_absolute_error(r_test, np.zeros_like(r_test))),
            },
            "train_samples": int(len(train_df)),
            "test_samples": int(len(test_df)),
            "train_positive_rate": climatology,
            "test_positive_rate": float(y_test.mean()),
            "test_period": {
                "start": test_df["observed_at"].min().isoformat(),
                "end": test_df["observed_at"].max().isoformat(),
            },
        }

        sample = test_df.sample(n=min(len(test_df), 6000), random_state=42)
        perm = permutation_importance(
            clf,
            sample[FEATURE_COLUMNS].to_numpy(dtype=float),
            sample["target_heavy"].to_numpy(dtype=int),
            scoring="average_precision",
            n_repeats=3,
            random_state=42,
        )
        importance = {
            col: round(float(max(val, 0.0)), 5)
            for col, val in zip(FEATURE_COLUMNS, perm.importances_mean)
        }
        importance = dict(sorted(importance.items(), key=lambda kv: -kv[1]))

        # 3) Modelo final: todos os dados disponíveis.
        X_all = data[FEATURE_COLUMNS].to_numpy(dtype=float)
        final_clf = _classifier().fit(X_all, data["target_heavy"].to_numpy(dtype=int))
        final_reg = _regressor().fit(X_all, data["target_rain_mm"].to_numpy(dtype=float))

        trained_at = datetime.now(tz=timezone.utc)
        metadata = {
            "version": trained_at.strftime("%Y%m%d%H%M"),
            "trained_at": trained_at.isoformat(),
            "algorithm": "HistGradientBoostingClassifier + HistGradientBoostingRegressor(poisson)",
            "target": f"chuva acumulada nas próximas {horizon_hours}h >= {heavy_rain_mm} mm",
            "horizon_hours": horizon_hours,
            "heavy_rain_mm": heavy_rain_mm,
            "samples": int(len(data)),
            "regions": sorted(data["region_code"].unique().tolist()) if "region_code" in data else [],
            "data_start": data["observed_at"].min().isoformat(),
            "data_end": data["observed_at"].max().isoformat(),
            "data_sources": data_sources or [],
            "feature_columns": FEATURE_COLUMNS,
            "metrics": metrics,
            "feature_importance": importance,
        }

        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "format": BUNDLE_FORMAT,
                "classifier": final_clf,
                "regressor": final_reg,
                "feature_columns": FEATURE_COLUMNS,
                "metadata": metadata,
            },
            self.model_path,
        )
        self.metadata_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")

        self._classifier, self._regressor, self._metadata = final_clf, final_reg, metadata
        return metadata

    def predict(self, features: "pd.DataFrame") -> tuple["np.ndarray", "np.ndarray"]:
        """Retorna (probabilidade de chuva forte, chuva esperada em mm) para cada linha."""
        if not self.is_loaded:
            raise RuntimeError("Modelo não carregado.")
        import numpy as np

        X = features[FEATURE_COLUMNS].to_numpy(dtype=float)
        proba = self._classifier.predict_proba(X)[:, 1]
        expected = np.clip(self._regressor.predict(X), 0.0, None)
        return proba, expected
