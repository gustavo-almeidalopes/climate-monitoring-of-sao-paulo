from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import REGION_SEEDS
from app.models.forecast_reading import ForecastReading
from app.models.region import Region
from app.models.weather_reading import WeatherReading
from app.services.types import NormalizedCurrentWeather, NormalizedForecastReading


class StorageService:
    async def ping(self, session: AsyncSession) -> bool:
        await session.execute(text("SELECT 1"))
        return True

    async def seed_regions(self, session: AsyncSession) -> None:
        existing_codes = set(
            (await session.scalars(select(Region.code))).all()
        )

        for region_seed in REGION_SEEDS:
            if region_seed["code"] in existing_codes:
                continue
            session.add(
                Region(
                    code=region_seed["code"],
                    name=region_seed["name"],
                    short_name=region_seed["short_name"],
                    color=region_seed["color"],
                    latitude=region_seed["latitude"],
                    longitude=region_seed["longitude"],
                )
            )
        await session.commit()

    async def list_regions(self, session: AsyncSession) -> list[Region]:
        rows = await session.scalars(select(Region).order_by(Region.code))
        return list(rows)

    async def get_region(self, session: AsyncSession, region_code: str) -> Region | None:
        stmt = select(Region).where(Region.code == region_code.upper())
        return await session.scalar(stmt)

    async def save_current_reading(
        self,
        session: AsyncSession,
        reading: NormalizedCurrentWeather,
        flood_risk_index: int,
    ) -> WeatherReading:
        row = WeatherReading(
            region_code=reading.region_code,
            temperature_c=reading.temperature_c,
            humidity_percent=reading.humidity_percent,
            rain_mm=reading.rain_mm,
            wind_kmh=reading.wind_kmh,
            aqi=reading.aqi,
            pm25=reading.pm25,
            pm10=reading.pm10,
            flood_risk_index=flood_risk_index,
            source=reading.source,
            recorded_at=reading.observed_at,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row

    async def save_forecast_readings(
        self,
        session: AsyncSession,
        region_code: str,
        readings: list[NormalizedForecastReading],
        risk_by_timestamp: dict[datetime, int],
    ) -> None:
        now_utc = datetime.now(tz=timezone.utc)
        await session.execute(
            delete(ForecastReading).where(
                and_(
                    ForecastReading.region_code == region_code,
                    ForecastReading.forecast_for >= now_utc,
                )
            )
        )

        for reading in readings:
            session.add(
                ForecastReading(
                    region_code=region_code,
                    forecast_for=reading.forecast_for,
                    temperature_c=reading.temperature_c,
                    humidity_percent=reading.humidity_percent,
                    rain_mm=reading.rain_mm,
                    wind_kmh=reading.wind_kmh,
                    flood_risk_index=risk_by_timestamp.get(reading.forecast_for, 0),
                    source=reading.source,
                    generated_at=now_utc,
                )
            )

        await session.commit()

    async def get_latest_reading_for_region(
        self,
        session: AsyncSession,
        region_code: str,
    ) -> WeatherReading | None:
        stmt = (
            select(WeatherReading)
            .where(WeatherReading.region_code == region_code.upper())
            .order_by(WeatherReading.recorded_at.desc())
            .limit(1)
        )
        return await session.scalar(stmt)

    async def get_latest_readings(self, session: AsyncSession) -> list[WeatherReading]:
        latest_subquery = (
            select(
                WeatherReading.region_code.label("region_code"),
                func.max(WeatherReading.recorded_at).label("max_recorded_at"),
            )
            .group_by(WeatherReading.region_code)
            .subquery()
        )

        stmt = (
            select(WeatherReading)
            .join(
                latest_subquery,
                and_(
                    WeatherReading.region_code == latest_subquery.c.region_code,
                    WeatherReading.recorded_at == latest_subquery.c.max_recorded_at,
                ),
            )
            .order_by(WeatherReading.region_code)
        )

        rows = await session.scalars(stmt)
        return list(rows)

    async def get_latest_readings_map(self, session: AsyncSession) -> dict[str, WeatherReading]:
        latest = await self.get_latest_readings(session)
        return {row.region_code: row for row in latest}

    async def get_forecast_by_region(
        self,
        session: AsyncSession,
        region_code: str,
        horizon_hours: int = 48,
    ) -> list[ForecastReading]:
        now_utc = datetime.now(tz=timezone.utc)
        until = now_utc + timedelta(hours=max(1, horizon_hours))

        stmt = (
            select(ForecastReading)
            .where(
                and_(
                    ForecastReading.region_code == region_code.upper(),
                    ForecastReading.forecast_for >= now_utc,
                    ForecastReading.forecast_for <= until,
                )
            )
            .order_by(ForecastReading.forecast_for.asc())
        )
        rows = await session.scalars(stmt)
        return list(rows)

    async def get_history_by_region(
        self,
        session: AsyncSession,
        region_code: str,
        days: int,
    ) -> list[WeatherReading]:
        start = datetime.now(tz=timezone.utc) - timedelta(days=max(1, days))
        stmt = (
            select(WeatherReading)
            .where(
                and_(
                    WeatherReading.region_code == region_code.upper(),
                    WeatherReading.recorded_at >= start,
                )
            )
            .order_by(WeatherReading.recorded_at.asc())
        )
        rows = await session.scalars(stmt)
        return list(rows)

    async def prune_old_data(
        self,
        session: AsyncSession,
        *,
        history_retention_days: int,
        forecast_retention_hours: int,
    ) -> dict[str, int]:
        weather_cutoff = datetime.now(tz=timezone.utc) - timedelta(days=max(1, history_retention_days))
        forecast_cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=max(1, forecast_retention_hours))

        weather_delete = await session.execute(
            delete(WeatherReading).where(WeatherReading.recorded_at < weather_cutoff)
        )
        forecast_delete = await session.execute(
            delete(ForecastReading).where(ForecastReading.forecast_for < forecast_cutoff)
        )

        await session.commit()
        return {
            "weather_deleted": max(int(weather_delete.rowcount or 0), 0),
            "forecast_deleted": max(int(forecast_delete.rowcount or 0), 0),
        }
