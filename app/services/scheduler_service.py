from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.services.storage_service import StorageService
from app.services.weather_service import WeatherService


class SchedulerService:
    def __init__(
        self,
        weather_service: WeatherService,
        storage_service: StorageService,
        session_factory: async_sessionmaker[AsyncSession],
        interval_minutes: int,
        current_data_ttl_minutes: int,
        history_retention_days: int,
        forecast_retention_hours: int,
    ) -> None:
        self.weather_service = weather_service
        self.storage_service = storage_service
        self.session_factory = session_factory
        self.interval_minutes = max(1, interval_minutes)
        self.current_data_ttl_minutes = max(1, current_data_ttl_minutes)
        self.history_retention_days = max(1, history_retention_days)
        self.forecast_retention_hours = max(1, forecast_retention_hours)

        self.scheduler = AsyncIOScheduler(timezone=timezone.utc)
        self._started = False
        self._running = False
        self._last_run_at: datetime | None = None
        self._last_success_at: datetime | None = None
        self._last_error: str | None = None
        self._lock = asyncio.Lock()

    def start(self) -> None:
        if self._started:
            return

        self.scheduler.add_job(
            self._refresh_cycle,
            trigger="interval",
            minutes=self.interval_minutes,
            id="weather-refresh-cycle",
            max_instances=1,
            coalesce=True,
            replace_existing=True,
        )
        self.scheduler.start()
        self._started = True

    async def _refresh_cycle(self) -> None:
        if self._lock.locked():
            return

        async with self._lock:
            self._running = True
            self._last_run_at = datetime.now(tz=timezone.utc)
            try:
                async with self.session_factory() as session:
                    await self.weather_service.ensure_current_data(
                        session,
                        force_refresh=False,
                        max_age_minutes=self.current_data_ttl_minutes,
                    )
                    await self.storage_service.prune_old_data(
                        session,
                        history_retention_days=self.history_retention_days,
                        forecast_retention_hours=self.forecast_retention_hours,
                    )
                self._last_success_at = datetime.now(tz=timezone.utc)
                self._last_error = None
            except Exception as exc:  # pragma: no cover - defensivo operacional
                self._last_error = str(exc)
            finally:
                self._running = False

    def status(self) -> dict:
        next_run_at = None
        job = self.scheduler.get_job("weather-refresh-cycle") if self._started else None
        if job and job.next_run_time:
            next_run_at = job.next_run_time
            if next_run_at.tzinfo is None:
                next_run_at = next_run_at.replace(tzinfo=timezone.utc)
            else:
                next_run_at = next_run_at.astimezone(timezone.utc)

        if not self._started:
            status = "stopped"
        elif self._running:
            status = "running"
        elif self._last_error:
            status = "degraded"
        else:
            status = "ok"

        return {
            "status": status,
            "interval_minutes": self.interval_minutes,
            "last_run_at": self._last_run_at,
            "last_success_at": self._last_success_at,
            "next_run_at": next_run_at,
            "last_error": self._last_error,
        }

    def shutdown(self) -> None:
        if not self._started:
            return
        self.scheduler.shutdown(wait=False)
        self._started = False
