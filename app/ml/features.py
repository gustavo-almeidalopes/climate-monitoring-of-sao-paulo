from __future__ import annotations

from datetime import datetime

# Ordem deve ser mantida — usada para treino e inferência.
FEATURE_COLUMNS: list[str] = [
    "rain_mm",
    "rain_3h",
    "rain_6h",
    "rain_24h",
    "humidity_percent",
    "temperature_c",
    "wind_kmh",
    "hour_of_day",
    "month",
    "rain_trend_3h",
    "humidity_delta_3h",
]


def build_features_dataframe(df: "pandas.DataFrame") -> "pandas.DataFrame":  # type: ignore[name-defined]
    """Adiciona colunas de feature a um DataFrame com histórico horário.

    Colunas esperadas: rain_mm, humidity_percent, temperature_c, wind_kmh, recorded_at
    Retorna DataFrame com as colunas FEATURE_COLUMNS preenchidas.
    """
    import pandas as pd

    df = df.copy().sort_values("recorded_at").reset_index(drop=True)
    df["recorded_at"] = pd.to_datetime(df["recorded_at"])

    df["rain_3h"] = df["rain_mm"].rolling(3, min_periods=1).sum()
    df["rain_6h"] = df["rain_mm"].rolling(6, min_periods=1).sum()
    df["rain_24h"] = df["rain_mm"].rolling(24, min_periods=1).sum()

    df["hour_of_day"] = df["recorded_at"].dt.hour
    df["month"] = df["recorded_at"].dt.month

    df["rain_trend_3h"] = df["rain_3h"] - df["rain_3h"].shift(3).fillna(0)
    df["humidity_delta_3h"] = df["humidity_percent"] - df["humidity_percent"].shift(3).fillna(
        df["humidity_percent"]
    )

    return df


def make_flood_labels(df: "pandas.DataFrame") -> "pandas.Series":  # type: ignore[name-defined]
    """Gera labels binárias de risco de alagamento.

    Limiares baseados nos níveis de alerta CEMADEN / Defesa Civil SP:
      - rain_24h > 50 mm  → alerta laranja/vermelho
      - rain_3h  > 20 mm  → chuva intensa em 3h
      - rain_mm  > 15 mm  → pico horário crítico
    """
    return (
        (df["rain_24h"] > 50) | (df["rain_3h"] > 20) | (df["rain_mm"] > 15)
    ).astype(int)


def extract_feature_vector(
    *,
    rain_mm: float,
    humidity_percent: int | float,
    temperature_c: float,
    wind_kmh: float,
    rain_3h: float = 0.0,
    rain_6h: float = 0.0,
    rain_24h: float = 0.0,
    observed_at: datetime | None = None,
    rain_trend_3h: float = 0.0,
    humidity_delta_3h: float = 0.0,
) -> list[float]:
    """Monta vetor de features na ordem de FEATURE_COLUMNS para inferência."""
    from datetime import timezone

    now = observed_at or datetime.now(tz=timezone.utc)
    return [
        float(rain_mm),
        float(rain_3h),
        float(rain_6h),
        float(rain_24h),
        float(humidity_percent),
        float(temperature_c),
        float(wind_kmh),
        float(now.hour),
        float(now.month),
        float(rain_trend_3h),
        float(humidity_delta_3h),
    ]
