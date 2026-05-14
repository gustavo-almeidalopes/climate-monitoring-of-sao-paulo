from __future__ import annotations

from pathlib import Path
from typing import Any

from app.ml.features import FEATURE_COLUMNS

_SKLEARN_AVAILABLE: bool | None = None


def _check_sklearn() -> bool:
    global _SKLEARN_AVAILABLE
    if _SKLEARN_AVAILABLE is None:
        try:
            import sklearn  # noqa: F401
            _SKLEARN_AVAILABLE = True
        except ImportError:
            _SKLEARN_AVAILABLE = False
    return _SKLEARN_AVAILABLE


class FloodRiskModel:
    """Modelo de classificação de risco de alagamento baseado em GradientBoosting.

    Entrada: vetor de features na ordem de FEATURE_COLUMNS.
    Saída: probabilidade 0.0–1.0 / score inteiro 0–100.
    Persiste em disco via joblib.
    """

    def __init__(self, model_path: Path) -> None:
        self.model_path = model_path
        self._pipeline: Any = None
        self._feature_importance: dict[str, float] = {}
        self._train_metrics: dict = {}

    @property
    def is_loaded(self) -> bool:
        return self._pipeline is not None

    def load(self) -> bool:
        """Carrega modelo do disco. Retorna True se bem-sucedido."""
        if not _check_sklearn():
            return False
        if not self.model_path.exists():
            return False
        try:
            import joblib

            self._pipeline = joblib.load(self.model_path)
            self._restore_feature_importance()
            return True
        except Exception:
            return False

    def train(self, X: "numpy.ndarray", y: "numpy.ndarray") -> dict:  # type: ignore[name-defined]
        """Treina o pipeline e salva em disco. Retorna métricas de avaliação."""
        if not _check_sklearn():
            raise RuntimeError("scikit-learn não está instalado.")

        import joblib
        import numpy as np
        from sklearn.ensemble import GradientBoostingClassifier
        from sklearn.metrics import classification_report, roc_auc_score
        from sklearn.model_selection import train_test_split
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y
        )

        pipeline = Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "clf",
                    GradientBoostingClassifier(
                        n_estimators=300,
                        max_depth=4,
                        learning_rate=0.05,
                        subsample=0.8,
                        min_samples_leaf=20,
                        random_state=42,
                    ),
                ),
            ]
        )

        pipeline.fit(X_train, y_train)

        y_pred = pipeline.predict(X_test)
        y_proba = pipeline.predict_proba(X_test)[:, 1]

        report = classification_report(y_test, y_pred, output_dict=True)
        metrics = {
            "roc_auc": float(roc_auc_score(y_test, y_proba)),
            "accuracy": float(report.get("accuracy", 0.0)),
            "precision_flood": float(report.get("1", {}).get("precision", 0.0)),
            "recall_flood": float(report.get("1", {}).get("recall", 0.0)),
            "f1_flood": float(report.get("1", {}).get("f1-score", 0.0)),
            "train_samples": int(len(X_train)),
            "test_samples": int(len(X_test)),
            "positive_rate": float(np.mean(y)),
        }

        self._pipeline = pipeline
        self._train_metrics = metrics
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(pipeline, self.model_path)
        self._restore_feature_importance()

        return metrics

    def predict_proba(self, feature_vector: list[float]) -> float:
        """Retorna probabilidade de alagamento (0.0–1.0)."""
        if not self.is_loaded:
            raise RuntimeError("Modelo não carregado.")
        import numpy as np

        X = np.array([feature_vector])
        return float(self._pipeline.predict_proba(X)[0, 1])

    def predict_risk_score(self, feature_vector: list[float]) -> int:
        """Retorna score de risco 0–100 derivado da probabilidade ML."""
        return min(100, int(round(self.predict_proba(feature_vector) * 100)))

    @property
    def feature_importance(self) -> dict[str, float]:
        return self._feature_importance

    @property
    def train_metrics(self) -> dict:
        return self._train_metrics

    def _restore_feature_importance(self) -> None:
        if self._pipeline is None:
            return
        clf = self._pipeline.named_steps.get("clf")
        if clf is not None and hasattr(clf, "feature_importances_"):
            self._feature_importance = {
                col: float(imp)
                for col, imp in zip(FEATURE_COLUMNS, clf.feature_importances_)
            }
