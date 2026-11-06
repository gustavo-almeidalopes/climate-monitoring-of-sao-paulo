"""Alertas ativos (Fase 4): quando o nível de uma região SOBE para Alto ou Crítico, avisa quem se
inscreveu — por Web Push (PWA) e pelo WhatsApp (Business Cloud API).

Regras:
- o nível é o critério único (app/core/risk_levels.py), o mesmo do painel;
- só a SUBIDA de nível gera alerta; repetir o mesmo nível não reenvia, e uma queda "rearma";
- dado de exemplo nunca chega aqui (o ciclo só lê leituras reais do banco);
- cada canal fica desligado até ser configurado; falha de um canal não impede o outro;
- inscrições canceladas ou endpoints expirados (HTTP 404/410 do push) são apagados (LGPD).
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Callable

import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.alerts import AlertLog, AlertState, PushSubscription, WhatsAppSubscriber

log = logging.getLogger("climasp.alerts")

LEVEL_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
LEVEL_LABEL = {"low": "Baixo", "medium": "Médio", "high": "Alto", "critical": "Crítico"}
REGION_NAMES = {"CV": "Casa Verde", "ST": "Santana", "JT": "Jaçanã", "MG": "Vila Maria"}
ALERT_MIN_RANK = LEVEL_RANK["high"]
MIN_LEVELS = ("high", "critical")


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def parse_regions(values: list[str] | str) -> list[str]:
    items = values.split(",") if isinstance(values, str) else values
    regions = sorted({v.strip().upper() for v in items if v and v.strip().upper() in REGION_NAMES})
    return regions


# ------------------------------------------------------------------ mensagem


def alert_text(region_code: str, level: str, rain_mm: float | None, reason: str) -> dict[str, str]:
    """Título e corpo do alerta, em português, sem emojis; o nível sempre por escrito."""
    name = REGION_NAMES.get(region_code, region_code)
    label = LEVEL_LABEL[level]
    rain = f"{rain_mm:.1f}".replace(".", ",") if rain_mm is not None else "—"
    if level == "critical":
        advice = "Risco elevado de alagamento: evite áreas de várzea e não atravesse ruas alagadas."
    else:
        advice = "Monitore as condições e evite áreas de risco."
    cause = f"chuva de {rain} mm/h" if reason == "chuva observada na última hora" else "chuva acumulada e previsão do modelo"
    return {
        "title": f"ClimaSP: risco {label.upper()} em {name}",
        "body": f"Nível {label} em {name} ({cause}). {advice}",
        "region": name,
        "level_label": label,
        "detail": cause,
    }


# ------------------------------------------------------------------ detecção de subida


async def detect_rises(session: AsyncSession, current: dict[str, dict]) -> list[dict]:
    """Compara o nível atual de cada região com o último visto e devolve as subidas para ≥ Alto.

    Primeira observação de uma região: só vira alerta se já estiver em Alto ou acima.
    """
    events: list[dict] = []
    states = {s.region_code: s for s in (await session.scalars(select(AlertState))).all()}
    now = _now()
    for code, region in current.items():
        level = region.get("level")
        if level not in LEVEL_RANK:
            continue
        state = states.get(code)
        previous = state.level if state else None
        if previous == level:
            continue
        rose = LEVEL_RANK[level] > LEVEL_RANK.get(previous, -1)
        if rose and LEVEL_RANK[level] >= ALERT_MIN_RANK:
            events.append({"region": code, "level": level, "previous": previous, "rain": region.get("rain"),
                           "reason": region.get("level_reason") or ""})
        if state:
            state.level, state.changed_at = level, now
        else:
            session.add(AlertState(region_code=code, level=level, changed_at=now))
    await session.commit()
    return events


# ------------------------------------------------------------------ Web Push


def push_configured() -> bool:
    s = get_settings()
    return bool(s.vapid_public_key and s.vapid_private_key and s.vapid_subject)


def _webpush_send(subscription: PushSubscription, payload: str) -> int:
    """Envia um push (síncrono; roda em thread). Devolve o status HTTP do serviço de push."""
    from pywebpush import WebPushException, webpush

    s = get_settings()
    try:
        resp = webpush(
            subscription_info={"endpoint": subscription.endpoint, "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth}},
            data=payload,
            vapid_private_key=s.vapid_private_key,
            vapid_claims={"sub": s.vapid_subject},
            ttl=3600,
            headers={"Urgency": "high"},
            timeout=10,
        )
        return getattr(resp, "status_code", 201)
    except WebPushException as exc:
        return getattr(exc.response, "status_code", 0) or 0


# Pode ser trocado nos testes (sem rede).
push_sender: Callable[[PushSubscription, str], int] = _webpush_send


async def send_push(session: AsyncSession, event: dict) -> tuple[int, int]:
    if not push_configured():
        return 0, 0
    rank = LEVEL_RANK[event["level"]]
    text = alert_text(event["region"], event["level"], event["rain"], event["reason"])
    payload = json.dumps({"title": text["title"], "body": text["body"], "region": event["region"],
                          "level": event["level"], "url": f"./?regiao={event['region']}"}, ensure_ascii=False)
    subs = (await session.scalars(select(PushSubscription))).all()
    ok = failed = 0
    for sub in subs:
        if event["region"] not in sub.regions.split(",") or rank < LEVEL_RANK.get(sub.min_level, ALERT_MIN_RANK):
            continue
        status = await asyncio.to_thread(push_sender, sub, payload)
        if 200 <= status < 300:
            ok += 1
            sub.last_sent_at = _now()
        else:
            failed += 1
            if status in (404, 410):  # inscrição expirada ou cancelada no navegador
                await session.delete(sub)
    await session.commit()
    return ok, failed


async def save_push_subscription(session: AsyncSession, *, endpoint: str, p256dh: str, auth: str,
                                 regions: list[str], min_level: str) -> PushSubscription:
    sub = await session.scalar(select(PushSubscription).where(PushSubscription.endpoint == endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth, regions=",".join(regions), min_level=min_level)
        session.add(sub)
    else:
        sub.p256dh, sub.auth, sub.regions, sub.min_level = p256dh, auth, ",".join(regions), min_level
    await session.commit()
    return sub


async def delete_push_subscription(session: AsyncSession, endpoint: str) -> bool:
    result = await session.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))
    await session.commit()
    return bool(result.rowcount)


# ------------------------------------------------------------------ WhatsApp (Business Cloud API)


def whatsapp_configured() -> bool:
    s = get_settings()
    return bool(s.whatsapp_token and s.whatsapp_phone_number_id)


# Pode ser trocado nos testes por um httpx.MockTransport.
whatsapp_transport: httpx.AsyncBaseTransport | None = None


async def _whatsapp_post(body: dict) -> int:
    s = get_settings()
    url = f"https://graph.facebook.com/{s.whatsapp_api_version}/{s.whatsapp_phone_number_id}/messages"
    async with httpx.AsyncClient(timeout=10, transport=whatsapp_transport) as client:
        resp = await client.post(url, json=body, headers={"Authorization": f"Bearer {s.whatsapp_token}"})
    if resp.status_code >= 300:
        log.warning("WhatsApp respondeu %s: %s", resp.status_code, resp.text[:300])
    return resp.status_code


async def whatsapp_text(wa_id: str, text: str) -> int:
    """Mensagem livre — só permitida em resposta, dentro da janela de 24 h aberta pela pessoa."""
    return await _whatsapp_post({"messaging_product": "whatsapp", "to": wa_id, "type": "text",
                                 "text": {"preview_url": False, "body": text}})


async def whatsapp_alert(wa_id: str, text: dict[str, str]) -> int:
    """Alerta proativo: exige um MODELO aprovado pela Meta (fora da janela de 24 h).

    Modelo esperado (categoria "utility"), com 3 variáveis no corpo:
      "Alerta ClimaSP: risco {{1}} em {{2}} ({{3}}). Evite áreas de alagamento.
       Responda SAIR para não receber mais."
    """
    s = get_settings()
    return await _whatsapp_post({
        "messaging_product": "whatsapp", "to": wa_id, "type": "template",
        "template": {"name": s.whatsapp_alert_template, "language": {"code": s.whatsapp_template_language},
                     "components": [{"type": "body", "parameters": [
                         {"type": "text", "text": text["level_label"].upper()},
                         {"type": "text", "text": text["region"]},
                         {"type": "text", "text": text["detail"]},
                     ]}]},
    })


async def send_whatsapp(session: AsyncSession, event: dict) -> tuple[int, int]:
    if not whatsapp_configured():
        return 0, 0
    rank = LEVEL_RANK[event["level"]]
    text = alert_text(event["region"], event["level"], event["rain"], event["reason"])
    subs = (await session.scalars(select(WhatsAppSubscriber))).all()
    ok = failed = 0
    for sub in subs:
        if event["region"] not in sub.regions.split(",") or rank < LEVEL_RANK.get(sub.min_level, ALERT_MIN_RANK):
            continue
        status = await whatsapp_alert(sub.wa_id, text)
        if 200 <= status < 300:
            ok += 1
            sub.last_sent_at = _now()
        else:
            failed += 1
    await session.commit()
    return ok, failed


def verify_whatsapp_signature(body: bytes, header: str | None) -> bool:
    """X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(app secret, corpo bruto)."""
    secret = get_settings().whatsapp_app_secret
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


def _norm(text: str) -> str:
    text = unicodedata.normalize("NFD", text.upper())
    return re.sub(r"\s+", " ", "".join(c for c in text if unicodedata.category(c) != "Mn")).strip()


_REGION_WORDS = {"CASA VERDE": "CV", "CACHOEIRINHA": "CV", "LIMAO": "CV", "SANTANA": "ST", "TUCURUVI": "ST",
                 "MANDAQUI": "ST", "JACANA": "JT", "TREMEMBE": "JT", "VILA MARIA": "MG", "VILA GUILHERME": "MG",
                 "VILA MEDEIROS": "MG", "ZONA NORTE": "ALL", "TODAS": "ALL"}

HELP_TEXT = ("ClimaSP: alertas de risco de alagamento na Zona Norte de SP. Envie o nome da sua região "
             "(Casa Verde, Santana, Jaçanã, Vila Maria ou TODAS) para receber avisos quando o risco ficar ALTO "
             "ou CRÍTICO. Envie CRITICO junto para só nível Crítico. Envie SAIR para cancelar e apagar seu cadastro.")


def parse_command(text: str) -> dict[str, Any]:
    """Comandos por texto: "SAIR" | "AJUDA" | nomes de região (+ "CRITICO")."""
    t = _norm(text)
    if t in {"SAIR", "PARAR", "CANCELAR", "STOP"}:
        return {"action": "stop"}
    regions: set[str] = set()
    for word, code in _REGION_WORDS.items():
        if re.search(rf"\b{word}\b", t):
            regions |= set(REGION_NAMES) if code == "ALL" else {code}
    if not regions:
        return {"action": "help"}
    return {"action": "subscribe", "regions": sorted(regions), "min_level": "critical" if re.search(r"\bCRITICO\b", t) else "high"}


async def handle_whatsapp_webhook(session: AsyncSession, payload: dict) -> int:
    """Processa mensagens recebidas. Devolve quantas mensagens de texto foram tratadas."""
    handled = 0
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            for msg in change.get("value", {}).get("messages", []) or []:
                if msg.get("type") != "text":
                    continue
                wa_id = str(msg.get("from", ""))[:32]
                if not wa_id.isdigit():
                    continue
                cmd = parse_command(msg.get("text", {}).get("body", ""))
                sub = await session.scalar(select(WhatsAppSubscriber).where(WhatsAppSubscriber.wa_id == wa_id))
                if cmd["action"] == "stop":
                    if sub:
                        await session.delete(sub)
                    reply = "ClimaSP: inscrição cancelada e seu número apagado. Envie o nome de uma região para voltar."
                elif cmd["action"] == "subscribe":
                    regions = ",".join(cmd["regions"])
                    if sub:
                        sub.regions, sub.min_level = regions, cmd["min_level"]
                    else:
                        session.add(WhatsAppSubscriber(wa_id=wa_id, regions=regions, min_level=cmd["min_level"], consent_at=_now()))
                    names = ", ".join(REGION_NAMES[c] for c in cmd["regions"])
                    level = "CRÍTICO" if cmd["min_level"] == "critical" else "ALTO ou CRÍTICO"
                    reply = f"ClimaSP: você vai receber alertas quando o risco ficar {level} em: {names}. Envie SAIR para cancelar."
                else:
                    reply = HELP_TEXT
                await session.commit()
                if whatsapp_configured():
                    await whatsapp_text(wa_id, reply)
                handled += 1
    return handled


# ------------------------------------------------------------------ ciclo


async def run_cycle(session: AsyncSession, current: dict[str, dict]) -> list[dict]:
    """Detecta subidas de nível e dispara os canais configurados. Chamado pelo agendador."""
    events = await detect_rises(session, current)
    for event in events:
        for channel, sender in (("web_push", send_push), ("whatsapp", send_whatsapp)):
            try:
                ok, failed = await sender(session, event)
            except Exception as exc:  # um canal fora do ar não derruba o outro
                log.warning("Falha no canal %s: %s", channel, exc)
                ok, failed = 0, -1
            if ok or failed:
                session.add(AlertLog(at=_now(), region_code=event["region"], level=event["level"], channel=channel,
                                     delivered=ok, failed=max(failed, 0)))
        await session.commit()
    return events
