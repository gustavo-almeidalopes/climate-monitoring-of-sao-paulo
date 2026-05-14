from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.db.session import AsyncSessionLocal
from app.repositories.news_repository import NewsRepository
from app.repositories.weather_repository import WeatherRepository
from app.services.http_client import ResilientHTTPClient
from app.services.ml_prediction_service import MLPredictionService
from app.services.providers.inmet import INMETProvider
from app.services.providers.open_meteo import OpenMeteoProvider
from app.services.providers.open_weather_map import OpenWeatherMapProvider
from app.services.scheduler_service import SchedulerService
from app.services.storage_service import StorageService
from app.services.weather_service import WeatherService


@lru_cache(maxsize=1)
def get_http_client() -> ResilientHTTPClient:
    return ResilientHTTPClient()


@lru_cache(maxsize=1)
def get_weather_repository() -> WeatherRepository:
    return WeatherRepository()


@lru_cache(maxsize=1)
def get_news_repository() -> NewsRepository:
    return NewsRepository()


@lru_cache(maxsize=1)
def get_storage_service() -> StorageService:
    """Compat alias — WeatherRepository é a implementação MVC; StorageService delega para ela."""
    return StorageService()


@lru_cache(maxsize=1)
def get_ml_prediction_service() -> MLPredictionService:
    service = MLPredictionService(storage=get_storage_service())
    loaded = service.try_load()
    if loaded:
        print("[ML] Modelo carregado do disco.")
    else:
        print("[ML] Modelo não treinado — usando heurístico como fallback.")
    return service


@lru_cache(maxsize=1)
def get_weather_service() -> WeatherService:
    http_client = get_http_client()
    providers = [
        OpenMeteoProvider(http_client=http_client),
        OpenWeatherMapProvider(http_client=http_client),
        INMETProvider(http_client=http_client),
    ]
    return WeatherService(
        providers=providers,
        storage=get_storage_service(),
        ml_service=get_ml_prediction_service(),
    )


@lru_cache(maxsize=1)
def get_scheduler_service() -> SchedulerService:
    settings = get_settings()
    return SchedulerService(
        weather_service=get_weather_service(),
        storage_service=get_storage_service(),
        session_factory=AsyncSessionLocal,
        interval_minutes=settings.scheduler_interval_minutes,
        current_data_ttl_minutes=settings.current_data_ttl_minutes,
        history_retention_days=settings.history_retention_days,
        forecast_retention_hours=settings.forecast_retention_hours,
    )


async def close_singletons() -> None:
    await get_http_client().close()
