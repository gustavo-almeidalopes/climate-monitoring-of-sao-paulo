"""Alertas (Fase 4) — /api/v1/alerts/*. Rotas novas; nenhuma rota existente muda.

- GET  /alerts/channels                canais ativos e chave pública VAPID (para o painel)
- POST /alerts/push/subscribe          inscreve um navegador/celular (Web Push)
- POST /alerts/push/unsubscribe        cancela e apaga
- GET  /alerts/whatsapp/webhook        verificação do webhook pela Meta
- POST /alerts/whatsapp/webhook        mensagens recebidas (inscrição por texto, SAIR)
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.services import alert_service

router = APIRouter(prefix="/alerts", tags=["Alertas"])


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def https_only(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("endpoint de push precisa ser https")
        return v


class SubscribeIn(BaseModel):
    subscription: PushSubscriptionIn
    regions: list[str] = Field(min_length=1, max_length=4)
    min_level: str = Field(default="high")

    @field_validator("min_level")
    @classmethod
    def valid_level(cls, v: str) -> str:
        if v not in alert_service.MIN_LEVELS:
            raise ValueError("min_level deve ser 'high' ou 'critical'")
        return v


class UnsubscribeIn(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.get("/channels")
async def channels() -> dict:
    s = get_settings()
    return {
        "web_push": alert_service.push_configured(),
        "vapid_public_key": s.vapid_public_key if alert_service.push_configured() else None,
        "whatsapp": alert_service.whatsapp_configured(),
        "whatsapp_number": s.whatsapp_display_number if alert_service.whatsapp_configured() else None,
        "regions": alert_service.REGION_NAMES,
        "min_levels": list(alert_service.MIN_LEVELS),
    }


@router.post("/push/subscribe", status_code=201)
async def push_subscribe(body: SubscribeIn, db: AsyncSession = Depends(get_db)) -> dict:
    if not alert_service.push_configured():
        raise HTTPException(status_code=503, detail="Notificações não configuradas: defina VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT no servidor.")
    regions = alert_service.parse_regions(body.regions)
    if not regions:
        raise HTTPException(status_code=422, detail="Escolha ao menos uma região monitorada (CV, ST, JT, MG).")
    await alert_service.save_push_subscription(db, endpoint=body.subscription.endpoint, p256dh=body.subscription.keys.p256dh,
                                               auth=body.subscription.keys.auth, regions=regions, min_level=body.min_level)
    return {"regions": regions, "min_level": body.min_level}


@router.post("/push/unsubscribe")
async def push_unsubscribe(body: UnsubscribeIn, db: AsyncSession = Depends(get_db)) -> dict:
    return {"deleted": await alert_service.delete_push_subscription(db, body.endpoint)}


@router.get("/whatsapp/webhook", include_in_schema=False)
async def whatsapp_verify(mode: str = Query(alias="hub.mode", default=""),
                          token: str = Query(alias="hub.verify_token", default=""),
                          challenge: str = Query(alias="hub.challenge", default="")) -> Response:
    expected = get_settings().whatsapp_verify_token
    if mode == "subscribe" and expected and token == expected:
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Verificação do webhook recusada.")


@router.post("/whatsapp/webhook", include_in_schema=False)
async def whatsapp_webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    if not get_settings().whatsapp_app_secret:
        raise HTTPException(status_code=503, detail="WhatsApp não configurado: defina WHATSAPP_APP_SECRET.")
    raw = await request.body()
    if not alert_service.verify_whatsapp_signature(raw, request.headers.get("X-Hub-Signature-256")):
        raise HTTPException(status_code=401, detail="Assinatura inválida.")
    handled = await alert_service.handle_whatsapp_webhook(db, json.loads(raw or b"{}"))
    return {"handled": handled}
