from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class SourceHealth(BaseModel):
    status: str
    last_success_at: datetime | None = None
    last_error: str | None = None


class SchedulerHealth(BaseModel):
    status: str
    interval_minutes: int
    last_run_at: datetime | None = None
    last_success_at: datetime | None = None
    next_run_at: datetime | None = None
    last_error: str | None = None


class DataHealth(BaseModel):
    ttl_minutes: int
    total_regions: int
    updated_regions: int
    stale_regions: list[str]


class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    database: str
    sources: dict[str, SourceHealth]
    scheduler: SchedulerHealth
    data: DataHealth
