"""Alertas (Fase 4): inscrições em Web Push e WhatsApp e o último nível visto por região.

Dados pessoais mínimos (LGPD): só o necessário para entregar o alerta — o endpoint do navegador
ou o número do WhatsApp, as regiões escolhidas e o nível mínimo. Cancelar a inscrição apaga a linha.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class PushSubscription(Base):
    __tablename__ = "alert_push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True, nullable=False)
    p256dh: Mapped[str] = mapped_column(String(200), nullable=False)
    auth: Mapped[str] = mapped_column(String(100), nullable=False)
    regions: Mapped[str] = mapped_column(String(40), nullable=False)        # "CV,ST"
    min_level: Mapped[str] = mapped_column(String(10), nullable=False, default="high")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WhatsAppSubscriber(Base):
    __tablename__ = "alert_whatsapp_subscribers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    wa_id: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)   # número no formato da Meta
    regions: Mapped[str] = mapped_column(String(40), nullable=False)
    min_level: Mapped[str] = mapped_column(String(10), nullable=False, default="high")
    consent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AlertState(Base):
    """Último nível observado por região — um alerta só sai quando o nível SOBE."""

    __tablename__ = "alert_region_state"

    region_code: Mapped[str] = mapped_column(String(4), primary_key=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class AlertLog(Base):
    """Registro de cada disparo (auditoria): quando, onde, por qual canal e para quantos."""

    __tablename__ = "alert_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    region_code: Mapped[str] = mapped_column(String(4), nullable=False)
    level: Mapped[str] = mapped_column(String(10), nullable=False)
    channel: Mapped[str] = mapped_column(String(12), nullable=False)
    delivered: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
