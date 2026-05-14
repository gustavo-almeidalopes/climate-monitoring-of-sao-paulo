from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.ml.features import extract_feature_vector
from app.ml.model import FloodRiskModel
from app.services.storage_service import StorageService


class MLPredictionService:
    """Serviço de predição de risco de alagamento baseado em modelo ML treinado.

    Usa os últimos registros históricos da região para calcular features com
    janelas temporais (rain_3h, rain_6h, rain_24h), enriquecendo a predição
    além do simples dado pontual atual.

    Fallback: se o modelo não estiver disponível, retorna None e o WeatherService
    usa o algoritmo heurístico de risk_service.py.
    """

    def __init__(self, storage: StorageService, model_path: Path | None = None) -> None:
        self.storage = storage
        settings = get_settings()
        _path = model_path or Path(settings.ml_model_path)
        self._model = FloodRiskModel(model_path=_path)
        self._loaded = False

    def try_load(self) -> bool:
        """Tenta carregar o modelo do disco. Chamado na inicialização da aplicação."""
        self._loaded = self._model.load()
        return self._loaded

    @property
    def model_available(self) -> bool:
        return self._loaded and self._model.is_loaded

    async def predict_risk(
        self,
        session: AsyncSession,
        region_code: str,
        rain_mm: float,
        humidity_percent: int | float,
        temperature_c: float,
        wind_kmh: float,
        observed_at: datetime | None = None,
    ) -> int | None:
        """Retorna score de risco 0–100 via ML, ou None se modelo indisponível.

        Busca os últimos registros da região no banco para montar as janelas
        temporais (rain_3h / 6h / 24h) que compõem as features do modelo.
        """
        if not self.model_available:
            return None

        try:
            recent = await self.storage.get_history_by_region(session, region_code, days=2)
        except Exception:
            recent = []

        rain_vals = [r.rain_mm for r in recent[-24:]]
        hum_vals = [r.humidity_percent for r in recent[-4:]]

        rain_3h = sum(rain_vals[-3:]) if len(rain_vals) >= 1 else 0.0
        rain_6h = sum(rain_vals[-6:]) if len(rain_vals) >= 1 else 0.0
        rain_24h = sum(rain_vals[-24:]) if len(rain_vals) >= 1 else 0.0

        rain_3h_prev = sum(rain_vals[-6:-3]) if len(rain_vals) >= 6 else 0.0
        rain_trend_3h = rain_3h - rain_3h_prev

        humidity_delta_3h = (hum_vals[-1] - hum_vals[0]) if len(hum_vals) >= 2 else 0.0

        feature_vector = extract_feature_vector(
            rain_mm=rain_mm,
            humidity_percent=humidity_percent,
            temperature_c=temperature_c,
            wind_kmh=wind_kmh,
            rain_3h=rain_3h,
            rain_6h=rain_6h,
            rain_24h=rain_24h,
            observed_at=observed_at,
            rain_trend_3h=rain_trend_3h,
            humidity_delta_3h=humidity_delta_3h,
        )

        try:
            loop = asyncio.get_event_loop()
            score = await loop.run_in_executor(
                None, self._model.predict_risk_score, feature_vector
            )
            return score
        except Exception:
            return None

    async def train(self, years: int | None = None) -> dict:
        """Coleta dados históricos e treina o modelo. Bloqueia até concluir.

        Retorna métricas de avaliação (ROC-AUC, F1, precision, recall).
        """
        from app.ml.dataset import collect_training_data
        from app.ml.features import build_features_dataframe, make_flood_labels

        settings = get_settings()
        _years = years or settings.ml_training_history_years

        import numpy as np

        raw_df = await collect_training_data(years=_years)

        region_dfs = []
        for region_code in raw_df["region_code"].unique():
            region_df = raw_df[raw_df["region_code"] == region_code].copy()
            region_df = build_features_dataframe(region_df)
            region_dfs.append(region_df)

        import pandas as pd

        df = pd.concat(region_dfs, ignore_index=True).dropna(subset=["rain_3h", "rain_24h"])

        from app.ml.features import FEATURE_COLUMNS

        X = df[FEATURE_COLUMNS].values.astype(float)
        y = make_flood_labels(df).values

        loop = asyncio.get_event_loop()
        metrics = await loop.run_in_executor(None, self._model.train, X, y)

        self._loaded = True
        return metrics

    def status(self) -> dict:
        return {
            "model_available": self.model_available,
            "model_path": str(self._model.model_path),
            "model_file_exists": self._model.model_path.exists(),
            "feature_importance": self._model.feature_importance,
            "train_metrics": self._model.train_metrics,
        }
