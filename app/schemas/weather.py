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
    aqi: int | None = None
    pm25: float | None = None
    pm10: float | None = None
    source: str
    recorded_at: datetime


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


class ApiInfoResponse(BaseModel):
    name: str
    version: str
    description: str
    docs_url: str
