from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_weather_service
from app.db.session import get_db
from app.schemas.weather import (
    CurrentRegionWeather,
    CurrentRegionsResponse,
    ForecastResponse,
    HistoryResponse,
    MetricsResponse,
    RefreshResponse,
    RegionOut,
    RegionMetrics,
    RegionsResponse,
)
from app.services.exceptions import NotFoundError, ProviderUnavailableError
from app.services.weather_service import WeatherService

router = APIRouter(prefix="/weather", tags=["Weather"])


@router.get("/regions", response_model=RegionsResponse)
async def list_regions(
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> RegionsResponse:
    regions = await weather_service.list_regions(db)
    return RegionsResponse(
        regions=[
            RegionOut(
                id=region.code,
                name=region.name,
                short=region.short_name,
                color=region.color,
                lat=region.latitude,
                lng=region.longitude,
            )
            for region in regions
        ]
    )


@router.get("/current", response_model=CurrentRegionsResponse)
async def current_all_regions(
    refresh_if_stale: bool = Query(default=True),
    max_age_minutes: int = Query(default=20, ge=1, le=360),
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> CurrentRegionsResponse:
    if refresh_if_stale:
        await weather_service.ensure_current_data(
            db,
            force_refresh=False,
            max_age_minutes=max_age_minutes,
        )

    updated_at, payload = await weather_service.get_current_all(db)

    if not payload:
        await weather_service.ensure_current_data(
            db,
            force_refresh=True,
            max_age_minutes=max_age_minutes,
        )
        updated_at, payload = await weather_service.get_current_all(db)

    return CurrentRegionsResponse(
        updated_at=updated_at,
        regions={code: CurrentRegionWeather(**data) for code, data in payload.items()},
    )


@router.get("/current/{region_id}", response_model=CurrentRegionWeather)
async def current_region(
    region_id: str,
    max_age_minutes: int = Query(default=20, ge=1, le=360),
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> CurrentRegionWeather:
    try:
        payload = await weather_service.get_current_by_region(
            db,
            region_id,
            max_age_minutes=max_age_minutes,
        )
        return CurrentRegionWeather(**payload)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/forecast/{region_id}", response_model=ForecastResponse)
async def forecast_region(
    region_id: str,
    horizon_hours: int = Query(default=48, ge=6, le=72),
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> ForecastResponse:
    try:
        region, generated_at, points = await weather_service.get_forecast_by_region(
            db,
            region_id,
            horizon_hours=horizon_hours,
        )
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return ForecastResponse(
        region=RegionOut(
            id=region.code,
            name=region.name,
            short=region.short_name,
            color=region.color,
            lat=region.latitude,
            lng=region.longitude,
        ),
        generated_at=generated_at,
        horizon_hours=horizon_hours,
        points=points,
    )


@router.get("/history/{region_id}", response_model=HistoryResponse)
async def history_region(
    region_id: str,
    days: int = Query(default=7, ge=1, le=7),
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> HistoryResponse:
    try:
        region, days_used, stats, rows = await weather_service.get_history_by_region(db, region_id, days)
    except NotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ProviderUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return HistoryResponse(
        region=RegionOut(
            id=region.code,
            name=region.name,
            short=region.short_name,
            color=region.color,
            lat=region.latitude,
            lng=region.longitude,
        ),
        days=days_used,
        stats=stats,
        readings=rows,
    )


@router.post("/refresh", response_model=RefreshResponse)
async def refresh_weather(
    force: bool = Query(default=True),
    max_age_minutes: int = Query(default=20, ge=1, le=360),
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> RefreshResponse:
    result = await weather_service.ensure_current_data(
        db,
        force_refresh=force,
        max_age_minutes=max_age_minutes,
    )

    return RefreshResponse(
        message="Atualizacao executada.",
        refreshed_at=datetime.now(tz=timezone.utc),
        regions_updated=int(result["updated"]),
        failed_regions=[str(row) for row in result["failures"]],
    )


@router.get("/metrics", response_model=MetricsResponse)
async def weather_metrics(
    max_age_minutes: int = Query(default=20, ge=1, le=360),
    db: AsyncSession = Depends(get_db),
    weather_service: WeatherService = Depends(get_weather_service),
) -> MetricsResponse:
    metrics = await weather_service.get_metrics(db, max_age_minutes=max_age_minutes)
    return MetricsResponse(
        timestamp=metrics["timestamp"],
        ttl_minutes=int(metrics["ttl_minutes"]),
        total_regions=int(metrics["total_regions"]),
        updated_regions=int(metrics["updated_regions"]),
        stale_regions=int(metrics["stale_regions"]),
        regions=[RegionMetrics(**row) for row in metrics["regions"]],
    )
