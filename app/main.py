from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.deps import (
    close_singletons,
    get_news_repository,
    get_scheduler_service,
    get_storage_service,
    get_weather_service,
)
from app.controllers.router import api_router
from app.core.config import get_settings
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.services.exceptions import ServiceError
from app.services.news_scraper_service import scrape_all_sources
from app.views.weather_views import ApiInfoResponse

settings = get_settings()

BASE_DIR = Path(__file__).resolve().parent.parent


async def _run_news_scrape() -> None:
    """Coleta notícias RSS e persiste artigos relevantes."""
    try:
        articles, _ = await scrape_all_sources()
        if articles:
            news_repo = get_news_repository()
            async with AsyncSessionLocal() as session:
                new = await news_repo.save_many(session, articles)
                if new:
                    print(f"[NewsScraper] {new} artigo(s) novo(s) salvo(s).")
    except Exception as exc:
        print(f"[NewsScraper] Erro durante scraping: {exc}")


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
            pass

    # Primeira coleta de notícias na inicialização
    await _run_news_scrape()

    # Agenda scraping de notícias a cada 30 min junto com o scheduler de clima
    scheduler.start()
    scheduler.add_job(_run_news_scrape, interval_minutes=30, job_id="news_scraper")

    try:
        yield
    finally:
        scheduler.shutdown()
        await close_singletons()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Backend MVC de monitoramento climático e alagamentos em São Paulo.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
)

app.include_router(api_router, prefix=settings.api_prefix)


@app.exception_handler(ServiceError)
async def service_error_handler(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=503, content={"error": "service_unavailable", "detail": str(exc)})


@app.get("/")
async def root() -> FileResponse:
    return FileResponse(str(BASE_DIR / "index.html"), media_type="text/html")
