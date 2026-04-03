from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_scheduler_service, get_storage_service, get_weather_service
from app.db.session import get_db
from app.schemas.health import DataHealth, HealthResponse, SchedulerHealth, SourceHealth
from app.services.scheduler_service import SchedulerService
from app.services.storage_service import StorageService
from app.services.weather_service import WeatherService

router = APIRouter(tags=["Health"])


@router.get("/health", response_model=HealthResponse)
async def healthcheck(
    db: AsyncSession = Depends(get_db),
    storage: StorageService = Depends(get_storage_service),
    weather_service: WeatherService = Depends(get_weather_service),
    scheduler_service: SchedulerService = Depends(get_scheduler_service),
) -> HealthResponse:
    db_status = "ok"
    try:
        await storage.ping(db)
    except Exception:
        db_status = "degraded"

    sources_state = weather_service.source_health()
    sources = {
        source_name: SourceHealth(
            status=state.status,
            last_success_at=state.last_success_at,
            last_error=state.last_error,
        )
        for source_name, state in sources_state.items()
    }

    metrics = {
        "ttl_minutes": int(weather_service.settings.current_data_ttl_minutes),
        "total_regions": 0,
        "updated_regions": 0,
        "stale_regions": 0,
        "stale_region_codes": [],
    }
    try:
        metrics = await weather_service.get_metrics(
            db,
            max_age_minutes=weather_service.settings.current_data_ttl_minutes,
        )
    except Exception:
        if db_status == "ok":
            db_status = "degraded"

    scheduler = scheduler_service.status()

    global_status = "ok"
    if db_status != "ok":
        global_status = "degraded"
    if any(state.status == "degraded" for state in sources.values()):
        global_status = "degraded"
    if scheduler["status"] in {"degraded", "stopped"}:
        global_status = "degraded"
    if int(metrics["stale_regions"]) > 0:
        global_status = "degraded"

    return HealthResponse(
        status=global_status,
        timestamp=datetime.now(tz=timezone.utc),
        database=db_status,
        sources=sources,
        scheduler=SchedulerHealth(**scheduler),
        data=DataHealth(
            ttl_minutes=int(metrics["ttl_minutes"]),
            total_regions=int(metrics["total_regions"]),
            updated_regions=int(metrics["updated_regions"]),
            stale_regions=[str(region_id) for region_id in metrics["stale_region_codes"]],
        ),
    )
