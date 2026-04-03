from __future__ import annotations

from datetime import datetime, timezone

from app.core.config import get_settings
from app.models.region import Region
from app.services.exceptions import ProviderUnavailableError
from app.services.http_client import ResilientHTTPClient
from app.services.providers.base import WeatherProvider
from app.services.types import NormalizedCurrentWeather, NormalizedForecastReading


def _to_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: object, default: int = 0) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return default


def _to_datetime(value: object) -> datetime:
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return datetime.now(tz=timezone.utc)


class OpenWeatherMapProvider(WeatherProvider):
    name = "openweathermap"

    def __init__(self, http_client: ResilientHTTPClient) -> None:
        self.http_client = http_client
        self.settings = get_settings()

    @property
    def available(self) -> bool:
        return bool(self.settings.openweather_api_key)

    def _require_key(self) -> str:
        if not self.settings.openweather_api_key:
            raise ProviderUnavailableError("OPENWEATHER_API_KEY nao configurada.")
        return self.settings.openweather_api_key

    async def get_current(self, region: Region) -> NormalizedCurrentWeather:
        api_key = self._require_key()
        payload = await self.http_client.get_json(
            source="openweathermap-current",
            url=self.settings.openweather_url,
            params={
                "lat": region.latitude,
                "lon": region.longitude,
                "appid": api_key,
                "units": "metric",
                "lang": "pt_br",
            },
        )

        main = payload.get("main") or {}
        rain = payload.get("rain") or {}
        wind = payload.get("wind") or {}

        return NormalizedCurrentWeather(
            region_code=region.code,
            temperature_c=_to_float(main.get("temp")),
            humidity_percent=_to_int(main.get("humidity")),
            rain_mm=_to_float(rain.get("1h")),
            wind_kmh=round(_to_float(wind.get("speed")) * 3.6, 2),
            aqi=None,
            pm25=None,
            pm10=None,
            observed_at=_to_datetime(payload.get("dt")),
            source=self.name,
        )

    async def get_forecast(self, region: Region, horizon_hours: int = 48) -> list[NormalizedForecastReading]:
        api_key = self._require_key()
        payload = await self.http_client.get_json(
            source="openweathermap-forecast",
            url=self.settings.openweather_forecast_url,
            params={
                "lat": region.latitude,
                "lon": region.longitude,
                "appid": api_key,
                "units": "metric",
                "lang": "pt_br",
                "cnt": max(1, min(40, int(horizon_hours / 3))),
            },
        )

        rows = payload.get("list") or []
        if not rows:
            raise ProviderUnavailableError("OpenWeatherMap retornou previsao vazia.")

        entries: list[NormalizedForecastReading] = []
        for row in rows:
            main = row.get("main") or {}
            rain = row.get("rain") or {}
            wind = row.get("wind") or {}
            entries.append(
                NormalizedForecastReading(
                    region_code=region.code,
                    forecast_for=_to_datetime(row.get("dt")),
                    temperature_c=_to_float(main.get("temp")),
                    humidity_percent=_to_int(main.get("humidity")),
                    rain_mm=_to_float(rain.get("3h")),
                    wind_kmh=round(_to_float(wind.get("speed")) * 3.6, 2),
                    source=self.name,
                )
            )

        return entries
