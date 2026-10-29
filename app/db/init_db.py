from __future__ import annotations

from app.db.base import Base
from app.db.session import engine
from app.models import (  # noqa: F401
    forecast_reading,
    hourly_observation,
    model_run,
    news_article,
    region,
    weather_reading,
)


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
