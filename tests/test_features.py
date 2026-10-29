from __future__ import annotations

import numpy as np
import pandas as pd

from app.ml.dataset import OBSERVATION_COLUMNS, parse_hourly_payload
from app.ml.features import FEATURE_COLUMNS, add_targets, build_features, regularize_hourly


def _frame(hours: int = 400, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    data = {col: rng.normal(20, 5, hours) for col in OBSERVATION_COLUMNS}
    data["precipitation_mm"] = np.clip(rng.normal(0, 2, hours), 0, None)
    data["observed_at"] = pd.date_range("2024-01-01", periods=hours, freq="h", tz="UTC")
    return pd.DataFrame(data)


def test_features_do_not_use_future_data():
    base = _frame()
    t = 300
    altered = base.copy()
    future = altered.index > t
    for col in OBSERVATION_COLUMNS:
        altered.loc[future, col] = altered.loc[future, col] * 3 + 50

    f_base = build_features(regularize_hourly(base))
    f_alt = build_features(regularize_hourly(altered))
    pd.testing.assert_series_equal(
        f_base.loc[t, FEATURE_COLUMNS], f_alt.loc[t, FEATURE_COLUMNS], check_names=False
    )


def test_target_is_rain_of_next_hours_only():
    df = _frame(50)
    df["precipitation_mm"] = 0.0
    df.loc[10, "precipitation_mm"] = 4.0
    df.loc[11, "precipitation_mm"] = 7.0
    out = add_targets(build_features(regularize_hourly(df)), horizon_hours=3, heavy_rain_mm=10.0)

    assert out.loc[9, "target_rain_mm"] == 11.0  # horas 10, 11, 12
    assert out.loc[9, "target_heavy"] == 1.0
    assert out.loc[10, "target_rain_mm"] == 7.0  # a própria hora 10 não entra no alvo
    assert out.loc[10, "target_heavy"] == 0.0
    assert np.isnan(out.loc[48, "target_rain_mm"])  # sem 3 horas futuras completas


def test_gaps_are_reindexed_and_rain_is_not_invented():
    df = _frame(48).drop(index=[20, 21])
    out = regularize_hourly(df)
    assert len(out) == 48
    assert out["precipitation_mm"].isna().sum() == 2
    assert out["temperature_c"].isna().sum() == 0  # interpolado (lacuna curta)


def test_parse_payload_uses_utc_and_skips_missing_precipitation():
    payload = {
        "hourly": {
            "time": [1704067200, 1704070800],
            "temperature_2m": [21.0, 22.0],
            "precipitation": [None, 1.2],
        }
    }
    records = parse_hourly_payload(payload, "CV", "test")
    assert len(records) == 1
    assert records[0].observed_at.isoformat() == "2024-01-01T01:00:00+00:00"
    assert records[0].values["precipitation_mm"] == 1.2
    assert records[0].values["pressure_hpa"] is None
