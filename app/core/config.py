from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "ClimaSP Backend"
    app_version: str = "1.0.0"
    api_prefix: str = "/api/v1"
    environment: str = "development"

    database_url: str = "sqlite+aiosqlite:///./climasp.db"
    scheduler_interval_minutes: int = 10

    request_timeout_seconds: float = 10.0
    max_retries: int = 3
    retry_backoff_seconds: float = 0.6

    token_bucket_capacity: int = 20
    token_bucket_refill_per_second: float = 6.0
    circuit_breaker_failure_threshold: int = 5
    circuit_breaker_recovery_seconds: int = 30

    open_meteo_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_air_quality_url: str = "https://air-quality-api.open-meteo.com/v1/air-quality"
    openweather_url: str = "https://api.openweathermap.org/data/2.5/weather"
    openweather_forecast_url: str = "https://api.openweathermap.org/data/2.5/forecast"
    openweather_api_key: str | None = None

    history_max_days: int = 7
    current_data_ttl_minutes: int = 20
    history_retention_days: int = 30
    forecast_retention_hours: int = 96

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
