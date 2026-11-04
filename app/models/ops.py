"""Operação (Fase 3): equipes, ocorrências com linha do tempo e registro do nowcast.

Enquanto não houver integração com os sistemas reais (Defesa Civil, Bombeiros, CET, SAMU,
subprefeituras), as equipes são DADOS DE EXEMPLO (`is_example = True`) e a interface as
rotula como fictícias em todos os lugares.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

TEAM_KINDS = ("defesa_civil", "bombeiros", "cet", "samu", "subprefeitura")
TEAM_STATUSES = ("disponivel", "em_deslocamento", "em_ocorrencia", "indisponivel")
INCIDENT_STATUSES = ("aberta", "despachada", "no_local", "resolvida")


class Team(Base):
    __tablename__ = "ops_teams"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(24), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    base_name: Mapped[str] = mapped_column(String(160), nullable=False)
    base_source: Mapped[str] = mapped_column(String(200), nullable=False)
    base_lat: Mapped[float] = mapped_column(Float, nullable=False)
    base_lng: Mapped[float] = mapped_column(Float, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="disponivel")
    is_example: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Incident(Base):
    __tablename__ = "ops_incidents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False, default="alagamento")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    address: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    region_code: Mapped[str | None] = mapped_column(String(4), nullable=True)
    status: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="aberta")
    team_id: Mapped[int | None] = mapped_column(ForeignKey("ops_teams.id"), nullable=True)
    eta_minutes: Mapped[float | None] = mapped_column(Float, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    arrived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_example: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class IncidentEvent(Base):
    __tablename__ = "ops_incident_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    incident_id: Mapped[int] = mapped_column(ForeignKey("ops_incidents.id"), index=True, nullable=False)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    kind: Mapped[str] = mapped_column(String(24), nullable=False)
    team_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    actor_role: Mapped[str] = mapped_column(String(16), nullable=False, default="operador")


class NowcastLog(Base):
    """Cada nowcast servido ao painel, por região e hora — base para medir o acerto do modelo."""

    __tablename__ = "ops_nowcast_log"
    __table_args__ = (UniqueConstraint("region_code", "as_of", name="uq_nowcast_region_hour"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_code: Mapped[str] = mapped_column(String(4), index=True, nullable=False)
    as_of: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, nullable=False)
    probability: Mapped[float] = mapped_column(Float, nullable=False)
    alert: Mapped[bool] = mapped_column(Boolean, nullable=False)
    heavy_rain_mm: Mapped[float] = mapped_column(Float, nullable=False)
    horizon_hours: Mapped[int] = mapped_column(Integer, nullable=False)
