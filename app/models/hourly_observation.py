from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HourlyObservation(Base):
    """Série horária real (Open-Meteo Archive/ERA5 + análise recente) usada para treino e inferência.

    Diferente de `weather_readings` (snapshots a cada ~10 min, com retenção curta), esta tabela
    guarda uma linha por hora e por região, sem expurgo, e é a base de dados do modelo de ML.
    """

    __tablename__ = "hourly_observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_code: Mapped[str] = mapped_column(
        String(4), ForeignKey("regions.code"), index=True, nullable=False
    )
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    dew_point_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    precipitation_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    pressure_hpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    cloud_cover_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_direction_deg: Mapped[float | None] = mapped_column(Float, nullable=True)
    wind_gust_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    soil_moisture: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False)

    __table_args__ = (
        UniqueConstraint("region_code", "observed_at", name="uq_hourly_obs_region_time"),
        Index("ix_hourly_obs_region_time", "region_code", "observed_at"),
    )
