from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class NormalizedCurrentWeather:
    region_code: str
    temperature_c: float
    humidity_percent: int
    rain_mm: float
    wind_kmh: float
    aqi: int | None
    pm25: float | None
    pm10: float | None
    observed_at: datetime
    source: str


@dataclass(slots=True)
class NormalizedForecastReading:
    region_code: str
    forecast_for: datetime
    temperature_c: float
    humidity_percent: int
    rain_mm: float
    wind_kmh: float
    source: str


@dataclass(slots=True)
class ProviderHealthState:
    status: str
    last_success_at: datetime | None
    last_error: str | None
