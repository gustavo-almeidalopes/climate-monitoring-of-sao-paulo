from __future__ import annotations

from abc import ABC, abstractmethod

from app.models.region import Region
from app.services.types import NormalizedCurrentWeather, NormalizedForecastReading


class WeatherProvider(ABC):
    name: str

    @abstractmethod
    async def get_current(self, region: Region) -> NormalizedCurrentWeather:
        raise NotImplementedError

    @abstractmethod
    async def get_forecast(self, region: Region, horizon_hours: int = 48) -> list[NormalizedForecastReading]:
        raise NotImplementedError

    @property
    def available(self) -> bool:
        return True
