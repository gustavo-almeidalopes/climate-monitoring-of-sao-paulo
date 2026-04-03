from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.deps import (
    close_singletons,
    get_scheduler_service,
    get_storage_service,
    get_weather_service,
)
from app.api.v1.health import router as health_router
from app.api.v1.weather import router as weather_router
from app.core.config import get_settings
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.schemas.weather import ApiInfoResponse
from app.services.exceptions import ServiceError

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()

    storage = get_storage_service()
    weather = get_weather_service()
    scheduler = get_scheduler_service()

    async with AsyncSessionLocal() as session:
        await storage.seed_regions(session)
        try:
            await weather.ensure_current_data(
                session,
                force_refresh=True,
                max_age_minutes=settings.current_data_ttl_minutes,
            )
            await storage.prune_old_data(
                session,
                history_retention_days=settings.history_retention_days,
                forecast_retention_hours=settings.forecast_retention_hours,
            )
        except Exception:
            # Mantemos a aplicacao de pe para o frontend iniciar mesmo sem fonte externa.
            pass

    scheduler.start()

    try:
        yield
    finally:
        scheduler.shutdown()
        await close_singletons()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Backend de monitoramento climatico em tempo real para Sao Paulo.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

app.include_router(health_router)
app.include_router(weather_router, prefix=settings.api_prefix)


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "error": "service_unavailable",
            "detail": str(exc),
        },
    )


@app.get("/", response_model=ApiInfoResponse)
async def root() -> ApiInfoResponse:
    return ApiInfoResponse(
        name=settings.app_name,
        version=settings.app_version,
        description="API para monitoramento climatico, previsao e historico por regiao.",
        docs_url="/docs",
    )
