"""Engenharia de features para previsão de chuva forte de curto prazo (nowcasting).

Regra de ouro: a feature na hora `t` usa SOMENTE dados de horas <= t. O alvo usa as horas
t+1 .. t+H. Assim o modelo aprende a *antecipar* chuva forte a partir de sinais físicos
(queda de pressão, umidade/ponto de orvalho, nebulosidade, vento, chuva acumulada), em vez de
reproduzir um limiar sobre a própria chuva já observada.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import pandas as pd

LOCAL_TZ = "America/Sao_Paulo"
RAIN_EPS_MM = 0.1

# Ordem fixa — usada no treino e na inferência.
FEATURE_COLUMNS: list[str] = [
    "precip_1h",
    "precip_lag1",
    "precip_lag2",
    "rain_3h",
    "rain_6h",
    "rain_12h",
    "rain_24h",
    "rain_72h",
    "rain_168h",
    "max_1h_24h",
    "hours_since_rain",
    "temperature_c",
    "humidity_percent",
    "dew_point_c",
    "dewpoint_depression",
    "temp_delta_3h",
    "humidity_delta_3h",
    "dew_point_delta_3h",
    "pressure_hpa",
    "pressure_tend_3h",
    "pressure_tend_6h",
    "pressure_tend_24h",
    "cloud_cover_percent",
    "cloud_delta_3h",
    "cloud_mean_6h",
    "wind_kmh",
    "wind_gust_kmh",
    "wind_u",
    "wind_v",
    "hour_sin",
    "hour_cos",
    "doy_sin",
    "doy_cos",
]

_CONTINUOUS = [
    "temperature_c",
    "humidity_percent",
    "dew_point_c",
    "pressure_hpa",
    "cloud_cover_percent",
    "wind_kmh",
    "wind_direction_deg",
    "wind_gust_kmh",
]


def regularize_hourly(df: "pd.DataFrame") -> "pd.DataFrame":
    """Reindexa uma série de UMA região para frequência horária contínua (UTC).

    Lacunas curtas (até 3 h) de variáveis contínuas são interpoladas; precipitação ausente
    permanece NaN (não inventamos chuva).
    """
    import pandas as pd

    from app.ml.dataset import OBSERVATION_COLUMNS

    if df.empty:
        return df.copy()

    out = df.copy()
    out["observed_at"] = pd.to_datetime(out["observed_at"], utc=True)
    out = out.sort_values("observed_at").drop_duplicates("observed_at", keep="last")
    out = out.set_index("observed_at")
    full_index = pd.date_range(out.index.min(), out.index.max(), freq="h", tz="UTC")
    out = out.reindex(full_index)
    out.index.name = "observed_at"

    for col in OBSERVATION_COLUMNS:
        if col not in out.columns:
            out[col] = float("nan")
        out[col] = pd.to_numeric(out[col], errors="coerce").astype(float)
    for col in _CONTINUOUS:
        out[col] = out[col].interpolate(limit=3, limit_area="inside")

    return out.reset_index()


def build_features(df: "pd.DataFrame") -> "pd.DataFrame":
    """Adiciona as colunas de FEATURE_COLUMNS a uma série horária regularizada de UMA região."""
    import numpy as np
    import pandas as pd

    out = df.copy()
    p = out["precipitation_mm"]

    out["precip_1h"] = p
    out["precip_lag1"] = p.shift(1)
    out["precip_lag2"] = p.shift(2)
    for hours in (3, 6, 12, 24, 72, 168):
        out[f"rain_{hours}h"] = p.rolling(hours, min_periods=1).sum()
    out["max_1h_24h"] = p.rolling(24, min_periods=1).max()

    position = pd.Series(np.arange(len(out), dtype=float), index=out.index)
    last_rain = position.where(p >= RAIN_EPS_MM).ffill()
    out["hours_since_rain"] = (position - last_rain).fillna(240.0).clip(upper=240.0)

    out["dewpoint_depression"] = out["temperature_c"] - out["dew_point_c"]
    out["temp_delta_3h"] = out["temperature_c"].diff(3)
    out["humidity_delta_3h"] = out["humidity_percent"].diff(3)
    out["dew_point_delta_3h"] = out["dew_point_c"].diff(3)

    out["pressure_tend_3h"] = out["pressure_hpa"].diff(3)
    out["pressure_tend_6h"] = out["pressure_hpa"].diff(6)
    out["pressure_tend_24h"] = out["pressure_hpa"].diff(24)

    out["cloud_delta_3h"] = out["cloud_cover_percent"].diff(3)
    out["cloud_mean_6h"] = out["cloud_cover_percent"].rolling(6, min_periods=1).mean()

    # Direção meteorológica: de onde o vento sopra. Convertemos em componentes u/v.
    direction = np.deg2rad(out["wind_direction_deg"])
    speed = out["wind_kmh"]
    out["wind_u"] = -speed * np.sin(direction)
    out["wind_v"] = -speed * np.cos(direction)

    local = pd.to_datetime(out["observed_at"], utc=True).dt.tz_convert(LOCAL_TZ)
    hour = local.dt.hour + local.dt.minute / 60.0
    doy = local.dt.day_of_year
    out["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    out["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    out["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)

    return out


def add_targets(df: "pd.DataFrame", horizon_hours: int, heavy_rain_mm: float) -> "pd.DataFrame":
    """Alvos: chuva acumulada em t+1..t+H (mm) e se ela atinge o limiar de chuva forte.

    Linhas sem as H horas futuras completas recebem NaN e são descartadas no treino.
    """
    out = df.copy()
    p = out["precipitation_mm"]
    future_sum = p[::-1].rolling(horizon_hours, min_periods=horizon_hours).sum()[::-1].shift(-1)
    out["target_rain_mm"] = future_sum
    out["target_heavy"] = (future_sum >= heavy_rain_mm).astype(float).where(future_sum.notna())
    return out


def build_training_frame(
    raw: "pd.DataFrame", horizon_hours: int, heavy_rain_mm: float
) -> "pd.DataFrame":
    """Monta o dataset supervisionado a partir de observações de várias regiões.

    Features e alvos são calculados dentro de cada região (janelas não cruzam regiões).
    """
    import pandas as pd

    frames = []
    for region_code, region_df in raw.groupby("region_code", sort=True):
        regular = regularize_hourly(region_df.drop(columns=["region_code"]))
        if regular.empty:
            continue
        feat = add_targets(build_features(regular), horizon_hours, heavy_rain_mm)
        feat["region_code"] = region_code
        frames.append(feat)

    if not frames:
        return pd.DataFrame(columns=[*FEATURE_COLUMNS, "target_rain_mm", "target_heavy"])

    data = pd.concat(frames, ignore_index=True)
    data = data[data["precipitation_mm"].notna() & data["target_rain_mm"].notna()]
    return data.sort_values(["observed_at", "region_code"]).reset_index(drop=True)
