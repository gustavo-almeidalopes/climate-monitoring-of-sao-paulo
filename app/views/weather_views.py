from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RegionOut(BaseModel):
    id: str
    name: str
    short: str
    color: str
    lat: float
    lng: float


class RegionsResponse(BaseModel):
    regions: list[RegionOut]


class CurrentRegionWeather(BaseModel):
    id: str
    name: str
    short: str
    color: str
    lat: float
    lng: float
    temp: float
    hum: int
    rain: float
    wind: float
    risk: int
    danger_level: str = "green"
    danger_color: str = "#22c55e"
    danger_label: str = "Baixo"
    aqi: int | None = None
    pm25: float | None = None
    pm10: float | None = None
    source: str
    recorded_at: datetime
    risk_source: str = "unknown"
    level: str = "low"
    level_label: str = "Baixo"
    level_reason: str = ""


class CurrentRegionsResponse(BaseModel):
    updated_at: datetime
    regions: dict[str, CurrentRegionWeather]


class ForecastPoint(BaseModel):
    forecast_for: datetime
    temp: float
    hum: int
    rain: float
    wind: float
    risk: int
    source: str
    risk_source: str = "unknown"
    level: str = "low"
    level_label: str = "Baixo"
    level_reason: str = ""


class ForecastResponse(BaseModel):
    region: RegionOut
    generated_at: datetime
    horizon_hours: int = Field(default=48)
    points: list[ForecastPoint]


class HistoryPoint(BaseModel):
    recorded_at: datetime
    temp: float
    hum: int
    rain: float
    wind: float
    risk: int
    source: str
    risk_source: str = "unknown"
    level: str = "low"
    level_label: str = "Baixo"
    level_reason: str = ""


class HistoryStats(BaseModel):
    samples: int
    risk_min: int
    risk_max: int
    risk_avg: float
    rain_total_mm: float
    temp_avg_c: float


class HistoryResponse(BaseModel):
    region: RegionOut
    days: int
    stats: HistoryStats
    readings: list[HistoryPoint]


class RefreshResponse(BaseModel):
    message: str
    refreshed_at: datetime
    regions_updated: int
    failed_regions: list[str] = Field(default_factory=list)


class RegionMetrics(BaseModel):
    id: str
    short: str
    last_recorded_at: datetime | None = None
    age_minutes: float | None = None
    stale: bool


class MetricsResponse(BaseModel):
    timestamp: datetime
    ttl_minutes: int
    total_regions: int
    updated_regions: int
    stale_regions: int
    regions: list[RegionMetrics]


class ThresholdsResponse(BaseModel):
    yellow_mm_h: float
    orange_mm_h: float
    red_mm_h: float
    levels: list[dict]
    # Cortes do índice de risco 0–100 usados no critério único (app/core/risk_levels.py).
    risk_cuts: dict[str, int] = Field(default_factory=dict)


class TrendOut(BaseModel):
    direction: str
    since: datetime | None = None
    delta: float = 0.0


class SeriesPoint(BaseModel):
    t: datetime
    kind: str
    rain: float
    risk: int
    risk_source: str = "unknown"
    level: str = "low"
    level_label: str = "Baixo"
    level_reason: str = ""


class RecentPoint(BaseModel):
    t: datetime
    rain: float
    risk: int


class NowcastOut(BaseModel):
    as_of: datetime
    horizon_hours: int | None = None
    heavy_rain_mm: float | None = None
    heavy_rain_probability: float
    heavy_rain_alert: bool
    expected_rain_next_mm: float


class OverviewRegion(CurrentRegionWeather):
    series: list[SeriesPoint]
    recent: list[RecentPoint]
    trend: dict[str, TrendOut]
    nowcast: NowcastOut | None = None


class OverviewResponse(BaseModel):
    generated_at: datetime
    updated_at: datetime
    thresholds: ThresholdsResponse
    model: dict
    regions: dict[str, OverviewRegion]


class ApiInfoResponse(BaseModel):
    name: str
    version: str
    description: str
    docs_url: str
