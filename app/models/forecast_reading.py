from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ForecastReading(Base):
    __tablename__ = "forecast_readings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_code: Mapped[str] = mapped_column(
        String(4), ForeignKey("regions.code"), index=True, nullable=False
    )
    forecast_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    temperature_c: Mapped[float] = mapped_column(Float, nullable=False)
    humidity_percent: Mapped[int] = mapped_column(Integer, nullable=False)
    rain_mm: Mapped[float] = mapped_column(Float, nullable=False)
    wind_kmh: Mapped[float] = mapped_column(Float, nullable=False)
    flood_risk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
