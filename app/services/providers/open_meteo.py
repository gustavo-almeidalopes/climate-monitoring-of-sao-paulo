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


class OpenMeteoProvider(WeatherProvider):
    name = "open-meteo"

    def __init__(self, http_client: ResilientHTTPClient) -> None:
        self.http_client = http_client
        self.settings = get_settings()

    async def get_current(self, region: Region) -> NormalizedCurrentWeather:
        weather_payload = await self.http_client.get_json(
            source="open-meteo-weather",
            url=self.settings.open_meteo_url,
            params={
                "latitude": region.latitude,
                "longitude": region.longitude,
                "current": "temperature_2m,relative_humidity_2m,rain,wind_speed_10m",
                "timezone": "America/Sao_Paulo",
                "timeformat": "unixtime",
            },
        )

        try:
            current_weather = weather_payload["current"]
        except KeyError as exc:
            raise ProviderUnavailableError("Open-Meteo retornou payload invalido para clima atual.") from exc

        aqi = None
        pm25 = None
        pm10 = None
        try:
            aq_payload = await self.http_client.get_json(
                source="open-meteo-air-quality",
                url=self.settings.open_meteo_air_quality_url,
                params={
                    "latitude": region.latitude,
                    "longitude": region.longitude,
                    "current": "us_aqi,pm2_5,pm10",
                    "timezone": "America/Sao_Paulo",
                    "timeformat": "unixtime",
                },
            )
            current_aq = aq_payload.get("current", {})
            aqi = _to_int(current_aq.get("us_aqi"), default=0) or None
            pm25 = _to_float(current_aq.get("pm2_5"), default=0.0) or None
            pm10 = _to_float(current_aq.get("pm10"), default=0.0) or None
        except ProviderUnavailableError:
            # Qualidade do ar e complementar. Mantemos leitura principal mesmo sem AQI.
            pass

        return NormalizedCurrentWeather(
            region_code=region.code,
            temperature_c=_to_float(current_weather.get("temperature_2m")),
            humidity_percent=_to_int(current_weather.get("relative_humidity_2m")),
            rain_mm=_to_float(current_weather.get("rain")),
            wind_kmh=_to_float(current_weather.get("wind_speed_10m")),
            aqi=aqi,
            pm25=pm25,
            pm10=pm10,
            observed_at=_to_datetime(current_weather.get("time")),
            source=self.name,
        )

    async def get_forecast(self, region: Region, horizon_hours: int = 48) -> list[NormalizedForecastReading]:
        payload = await self.http_client.get_json(
            source="open-meteo-forecast",
            url=self.settings.open_meteo_url,
            params={
                "latitude": region.latitude,
                "longitude": region.longitude,
                "hourly": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
                "forecast_hours": max(1, min(72, horizon_hours)),
                "timezone": "America/Sao_Paulo",
                "timeformat": "unixtime",
            },
        )

        hourly = payload.get("hourly", {})
        times = hourly.get("time") or []
        temps = hourly.get("temperature_2m") or []
        hums = hourly.get("relative_humidity_2m") or []
        rains = hourly.get("precipitation") or []
        winds = hourly.get("wind_speed_10m") or []

        if not times:
            raise ProviderUnavailableError("Open-Meteo retornou previsao vazia.")

        entries: list[NormalizedForecastReading] = []
        for values in zip(times, temps, hums, rains, winds):
            ts, temp, hum, rain, wind = values
            entries.append(
                NormalizedForecastReading(
                    region_code=region.code,
                    forecast_for=_to_datetime(ts),
                    temperature_c=_to_float(temp),
                    humidity_percent=_to_int(hum),
                    rain_mm=_to_float(rain),
                    wind_kmh=_to_float(wind),
                    source=self.name,
                )
            )

        return entries
