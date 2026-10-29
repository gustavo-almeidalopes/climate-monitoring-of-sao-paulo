from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ModelRun(Base):
    """Registro auditável de cada execução de treino do modelo de ML."""

    __tablename__ = "model_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False)  # running | success | failed
    trigger: Mapped[str] = mapped_column(String(40), nullable=False)  # api | scheduler | bootstrap | cli
    model_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    samples: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metrics_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
