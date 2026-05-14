from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.region import Region
from app.models.weather_reading import WeatherReading
from app.services.exceptions import NotFoundError, ProviderUnavailableError
from app.services.providers.base import WeatherProvider
from app.services.risk_service import calculate_flood_risk
from app.services.storage_service import StorageService
from app.services.types import (
    NormalizedCurrentWeather,
    NormalizedForecastReading,
    ProviderHealthState,
)

if TYPE_CHECKING:
    from app.services.ml_prediction_service import MLPredictionService


class WeatherService:
    def __init__(
        self,
        providers: list[WeatherProvider],
        storage: StorageService,
        ml_service: MLPredictionService | None = None,
    ) -> None:
        self.providers = providers
        self.storage = storage
        self.ml_service = ml_service
        self.settings = get_settings()
        self._refresh_lock = asyncio.Lock()
        self._health: dict[str, ProviderHealthState] = {
            provider.name: ProviderHealthState(
                status="degraded" if not provider.available else "unknown",
                last_success_at=None,
                last_error="OPENWEATHER_API_KEY ausente" if not provider.available else None,
            )
            for provider in providers
        }

    def _mark_provider_success(self, provider_name: str) -> None:
        self._health[provider_name] = ProviderHealthState(
            status="ok",
            last_success_at=datetime.now(tz=timezone.utc),
            last_error=None,
        )

    def _mark_provider_failure(self, provider_name: str, error: str) -> None:
        previous = self._health.get(provider_name)
        self._health[provider_name] = ProviderHealthState(
            status="degraded",
            last_success_at=previous.last_success_at if previous else None,
            last_error=error,
        )

    def source_health(self) -> dict[str, ProviderHealthState]:
        return self._health

    @staticmethod
    def _as_utc(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    def _age_minutes(self, recorded_at: datetime, *, now: datetime | None = None) -> float:
        anchor = now or datetime.now(tz=timezone.utc)
        delta = anchor - self._as_utc(recorded_at)
        return round(max(delta.total_seconds(), 0.0) / 60.0, 1)

    def _is_stale(self, recorded_at: datetime | None, max_age_minutes: int) -> bool:
        if recorded_at is None:
            return True
        return self._age_minutes(recorded_at) > max(1, max_age_minutes)

    async def ensure_current_data(
        self,
        session: AsyncSession,
        *,
        force_refresh: bool = False,
        max_age_minutes: int | None = None,
    ) -> dict[str, int | list[str]]:
        ttl = max(1, max_age_minutes or self.settings.current_data_ttl_minutes)
        return await self.refresh_all_regions(
            session,
            only_stale=not force_refresh,
            max_age_minutes=ttl,
        )

    async def refresh_all_regions(
        self,
        session: AsyncSession,
        *,
        only_stale: bool = False,
        max_age_minutes: int | None = None,
    ) -> dict[str, int | list[str]]:
        async with self._refresh_lock:
            ttl = max(1, max_age_minutes or self.settings.current_data_ttl_minutes)
            regions = await self.storage.list_regions(session)
            latest_map = await self.storage.get_latest_readings_map(session)

            updated = 0
            skipped = 0
            failures: list[str] = []

            for region in regions:
                latest = latest_map.get(region.code)
                if only_stale and latest and not self._is_stale(latest.recorded_at, ttl):
                    skipped += 1
                    continue

                try:
                    await self.refresh_region(session, region.code)
                    updated += 1
                except ProviderUnavailableError as exc:
                    failures.append(f"{region.code}: {exc}")

            return {
                "updated": updated,
                "skipped": skipped,
                "failures": failures,
            }

    async def refresh_region(self, session: AsyncSession, region_code: str) -> WeatherReading:
        region = await self.storage.get_region(session, region_code)
        if not region:
            raise NotFoundError(f"Regiao {region_code.upper()} nao encontrada.")

        cached = await self.storage.get_latest_reading_for_region(session, region.code)
        try:
            current = await self._fetch_current_with_fallback(region)
        except ProviderUnavailableError:
            if cached is not None:
                # Mantemos continuidade operacional mesmo com fonte externa indisponivel.
                return cached
            raise

        ml_risk = None
        if self.ml_service is not None:
            ml_risk = await self.ml_service.predict_risk(
                session=session,
                region_code=region.code,
                rain_mm=current.rain_mm,
                humidity_percent=current.humidity_percent,
                temperature_c=current.temperature_c,
                wind_kmh=current.wind_kmh,
                observed_at=current.observed_at,
            )

        heuristic_risk = calculate_flood_risk(
            rain_mm=current.rain_mm,
            humidity_percent=current.humidity_percent,
            wind_kmh=current.wind_kmh,
            temperature_c=current.temperature_c,
            aqi=current.aqi,
        )
        risk = ml_risk if ml_risk is not None else heuristic_risk

        reading_row = await self.storage.save_current_reading(session, current, risk)

        try:
            forecast = await self._fetch_forecast_with_fallback(
                region,
                preferred_source=current.source,
            )
            risk_by_timestamp = {
                item.forecast_for: calculate_flood_risk(
                    rain_mm=item.rain_mm,
                    humidity_percent=item.humidity_percent,
                    wind_kmh=item.wind_kmh,
                    temperature_c=item.temperature_c,
                    aqi=current.aqi,
                )
                for item in forecast
            }
            await self.storage.save_forecast_readings(session, region.code, forecast, risk_by_timestamp)
        except ProviderUnavailableError:
            # Mantemos o dado atual salvo mesmo se a previsao falhar nesta rodada.
            pass

        return reading_row

    async def _fetch_current_with_fallback(self, region: Region) -> NormalizedCurrentWeather:
        errors: list[str] = []

        for provider in self.providers:
            if not provider.available:
                self._mark_provider_failure(provider.name, "Provider desabilitado sem credenciais.")
                continue

            try:
                data = await provider.get_current(region)
                self._mark_provider_success(provider.name)
                return data
            except ProviderUnavailableError as exc:
                self._mark_provider_failure(provider.name, str(exc))
                errors.append(f"{provider.name}: {exc}")

        raise ProviderUnavailableError(
            "Todas as fontes falharam para clima atual. " + " | ".join(errors)
        )

    async def _fetch_forecast_with_fallback(
        self,
        region: Region,
        preferred_source: str,
        horizon_hours: int = 48,
    ) -> list[NormalizedForecastReading]:
        ordered = sorted(
            self.providers,
            key=lambda provider: 0 if provider.name == preferred_source else 1,
        )

        errors: list[str] = []
        for provider in ordered:
            if not provider.available:
                self._mark_provider_failure(provider.name, "Provider desabilitado sem credenciais.")
                continue
            try:
                points = await provider.get_forecast(region, horizon_hours=horizon_hours)
                self._mark_provider_success(provider.name)
                return points
            except ProviderUnavailableError as exc:
                self._mark_provider_failure(provider.name, str(exc))
                errors.append(f"{provider.name}: {exc}")

        raise ProviderUnavailableError(
            "Todas as fontes falharam para previsao. " + " | ".join(errors)
        )

    async def list_regions(self, session: AsyncSession) -> list[Region]:
        return await self.storage.list_regions(session)

    async def get_current_all(self, session: AsyncSession) -> tuple[datetime, dict[str, dict]]:
        regions = await self.storage.list_regions(session)
        region_by_code = {region.code: region for region in regions}
        readings = await self.storage.get_latest_readings(session)

        payload: dict[str, dict] = {}
        newest_ts = datetime.fromtimestamp(0, tz=timezone.utc)

        for reading in readings:
            region = region_by_code.get(reading.region_code)
            if region is None:
                continue
            payload[reading.region_code] = self._serialize_current(region, reading)
            newest_ts = max(newest_ts, self._as_utc(reading.recorded_at))

        if newest_ts.year <= 1971:
            newest_ts = datetime.now(tz=timezone.utc)

        return newest_ts, payload

    async def get_current_by_region(
        self,
        session: AsyncSession,
        region_code: str,
        *,
        max_age_minutes: int | None = None,
    ) -> dict:
        ttl = max(1, max_age_minutes or self.settings.current_data_ttl_minutes)

        region = await self.storage.get_region(session, region_code)
        if not region:
            raise NotFoundError(f"Regiao {region_code.upper()} nao encontrada.")

        reading = await self.storage.get_latest_reading_for_region(session, region.code)
        if reading is None or self._is_stale(reading.recorded_at, ttl):
            try:
                reading = await self.refresh_region(session, region.code)
            except ProviderUnavailableError:
                if reading is None:
                    raise

        return self._serialize_current(region, reading)

    async def get_forecast_by_region(
        self,
        session: AsyncSession,
        region_code: str,
        horizon_hours: int = 48,
    ) -> tuple[Region, datetime, list[dict]]:
        region = await self.storage.get_region(session, region_code)
        if not region:
            raise NotFoundError(f"Regiao {region_code.upper()} nao encontrada.")

        points = await self.storage.get_forecast_by_region(session, region.code, horizon_hours)
        if not points:
            await self.refresh_region(session, region.code)
            points = await self.storage.get_forecast_by_region(session, region.code, horizon_hours)
            if not points:
                raise ProviderUnavailableError(
                    "Nao foi possivel obter previsao para a regiao no momento."
                )

        generated_at = self._as_utc(points[0].generated_at) if points else datetime.now(tz=timezone.utc)

        payload = [
            {
                "forecast_for": self._as_utc(row.forecast_for),
                "temp": round(row.temperature_c, 1),
                "hum": int(row.humidity_percent),
                "rain": round(row.rain_mm, 2),
                "wind": round(row.wind_kmh, 1),
                "risk": int(row.flood_risk_index),
                "source": row.source,
            }
            for row in points
        ]

        return region, generated_at, payload

    async def get_history_by_region(
        self,
        session: AsyncSession,
        region_code: str,
        days: int,
    ) -> tuple[Region, int, dict, list[dict]]:
        safe_days = max(1, min(days, self.settings.history_max_days))
        region = await self.storage.get_region(session, region_code)
        if not region:
            raise NotFoundError(f"Regiao {region_code.upper()} nao encontrada.")

        rows = await self.storage.get_history_by_region(session, region.code, safe_days)
        if not rows:
            await self.refresh_region(session, region.code)
            rows = await self.storage.get_history_by_region(session, region.code, safe_days)

        readings_payload = [
            {
                "recorded_at": self._as_utc(row.recorded_at),
                "temp": round(row.temperature_c, 1),
                "hum": int(row.humidity_percent),
                "rain": round(row.rain_mm, 2),
                "wind": round(row.wind_kmh, 1),
                "risk": int(row.flood_risk_index),
                "source": row.source,
            }
            for row in rows
        ]

        stats = self._build_history_stats(rows)
        return region, safe_days, stats, readings_payload

    async def get_metrics(
        self,
        session: AsyncSession,
        *,
        max_age_minutes: int | None = None,
    ) -> dict:
        ttl = max(1, max_age_minutes or self.settings.current_data_ttl_minutes)
        now = datetime.now(tz=timezone.utc)

        regions = await self.storage.list_regions(session)
        latest_map = await self.storage.get_latest_readings_map(session)

        output_regions: list[dict] = []
        stale_codes: list[str] = []
        updated_regions = 0

        for region in regions:
            latest = latest_map.get(region.code)
            if latest is None:
                stale_codes.append(region.code)
                output_regions.append(
                    {
                        "id": region.code,
                        "short": region.short_name,
                        "last_recorded_at": None,
                        "age_minutes": None,
                        "stale": True,
                    }
                )
                continue

            age = self._age_minutes(latest.recorded_at, now=now)
            is_stale = age > ttl
            if is_stale:
                stale_codes.append(region.code)
            else:
                updated_regions += 1

            output_regions.append(
                {
                    "id": region.code,
                    "short": region.short_name,
                    "last_recorded_at": self._as_utc(latest.recorded_at),
                    "age_minutes": age,
                    "stale": is_stale,
                }
            )

        return {
            "timestamp": now,
            "ttl_minutes": ttl,
            "total_regions": len(regions),
            "updated_regions": updated_regions,
            "stale_regions": len(stale_codes),
            "regions": output_regions,
            "stale_region_codes": stale_codes,
        }

    @staticmethod
    def _build_history_stats(rows: list[WeatherReading]) -> dict:
        if not rows:
            return {
                "samples": 0,
                "risk_min": 0,
                "risk_max": 0,
                "risk_avg": 0.0,
                "rain_total_mm": 0.0,
                "temp_avg_c": 0.0,
            }

        risks = [row.flood_risk_index for row in rows]
        rains = [row.rain_mm for row in rows]
        temps = [row.temperature_c for row in rows]

        return {
            "samples": len(rows),
            "risk_min": min(risks),
            "risk_max": max(risks),
            "risk_avg": round(sum(risks) / len(risks), 1),
            "rain_total_mm": round(sum(rains), 2),
            "temp_avg_c": round(sum(temps) / len(temps), 1),
        }

    @staticmethod
    def _serialize_region(region: Region) -> dict:
        return {
            "id": region.code,
            "name": region.name,
            "short": region.short_name,
            "color": region.color,
            "lat": region.latitude,
            "lng": region.longitude,
        }

    def _serialize_current(self, region: Region, reading: WeatherReading) -> dict:
        payload = self._serialize_region(region)
        payload.update(
            {
                "temp": round(reading.temperature_c, 1),
                "hum": int(reading.humidity_percent),
                "rain": round(reading.rain_mm, 2),
                "wind": round(reading.wind_kmh, 1),
                "risk": int(reading.flood_risk_index),
                "aqi": reading.aqi,
                "pm25": round(reading.pm25, 2) if reading.pm25 is not None else None,
                "pm10": round(reading.pm10, 2) if reading.pm10 is not None else None,
                "source": reading.source,
                "recorded_at": self._as_utc(reading.recorded_at),
            }
        )
        return payload
