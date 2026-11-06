"""Fase 4: alertas ativos por Web Push e WhatsApp quando o nível de uma região sobe."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.core.config import get_settings
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.models.alerts import AlertLog, AlertState, PushSubscription, WhatsAppSubscriber
from app.services import alert_service

ENDPOINT = "https://push.example.test/sub/abc"
KEYS = {"p256dh": "B" * 87, "auth": "A" * 22}


def region(level: str, rain: float = 25.0) -> dict:
    return {"level": level, "rain": rain, "level_reason": "chuva observada na última hora"}


async def _reset():
    await init_db()
    async with AsyncSessionLocal() as s:
        for model in (AlertLog, AlertState, PushSubscription, WhatsAppSubscriber):
            await s.execute(delete(model))
        await s.commit()


@pytest.fixture()
def channels_on(monkeypatch):
    for k, v in {"VAPID_PUBLIC_KEY": "BPUB", "VAPID_PRIVATE_KEY": "priv", "VAPID_SUBJECT": "mailto:teste@example.org",
                 "WHATSAPP_TOKEN": "tok", "WHATSAPP_PHONE_NUMBER_ID": "123", "WHATSAPP_VERIFY_TOKEN": "verifica",
                 "WHATSAPP_APP_SECRET": "segredo"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def whatsapp_calls(monkeypatch):
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"url": str(request.url), "auth": request.headers["Authorization"], "body": json.loads(request.content)})
        return httpx.Response(200, json={"messages": [{"id": "wamid.teste"}]})

    monkeypatch.setattr(alert_service, "whatsapp_transport", httpx.MockTransport(handler))
    return calls


@pytest.fixture()
def client():
    from app.main import app
    return TestClient(app)


def test_so_a_subida_para_alto_ou_critico_gera_alerta():
    async def scenario():
        await _reset()
        async with AsyncSessionLocal() as s:
            steps = [("medium", []), ("high", ["high"]), ("high", []), ("critical", ["critical"]),
                     ("low", []), ("high", ["high"])]
            for level, expected in steps:
                events = await alert_service.detect_rises(s, {"ST": region(level)})
                assert [e["level"] for e in events] == expected, level
            # primeira observação já em Alto: alerta; primeira em Baixo: não
            events = await alert_service.detect_rises(s, {"ST": region("high"), "CV": region("critical"), "JT": region("low")})
            assert [(e["region"], e["level"]) for e in events] == [("CV", "critical")]
    asyncio.run(scenario())


def test_mensagem_em_portugues_sem_emojis_com_nivel_por_escrito():
    text = alert_service.alert_text("JT", "critical", 42.3, "chuva observada na última hora")
    assert text["title"] == "ClimaSP: risco CRÍTICO em Jaçanã"
    assert "42,3 mm/h" in text["body"] and "Crítico" in text["body"]
    assert all(ord(c) < 0x2190 for c in text["title"] + text["body"])


def test_web_push_filtra_por_regiao_e_nivel_e_apaga_inscricao_expirada(channels_on, monkeypatch):
    sent: list[tuple[str, dict]] = []

    def fake_sender(sub, payload):
        sent.append((sub.endpoint, json.loads(payload)))
        return 410 if sub.endpoint.endswith("expirada") else 201

    monkeypatch.setattr(alert_service, "push_sender", fake_sender)

    async def scenario():
        await _reset()
        async with AsyncSessionLocal() as s:
            await alert_service.save_push_subscription(s, endpoint=ENDPOINT, regions=["ST"], min_level="high", **KEYS)
            await alert_service.save_push_subscription(s, endpoint=ENDPOINT + "/so-critico", regions=["ST"], min_level="critical", **KEYS)
            await alert_service.save_push_subscription(s, endpoint=ENDPOINT + "/outra-regiao", regions=["CV"], min_level="high", **KEYS)
            await alert_service.save_push_subscription(s, endpoint=ENDPOINT + "/expirada", regions=["ST"], min_level="high", **KEYS)
            ok, failed = await alert_service.send_push(s, {"region": "ST", "level": "high", "rain": 22.0,
                                                           "reason": "chuva observada na última hora"})
            remaining = {p.endpoint for p in (await s.scalars(select(PushSubscription))).all()}
        return ok, failed, remaining

    ok, failed, remaining = asyncio.run(scenario())
    assert (ok, failed) == (1, 1)
    assert [e for e, _ in sent] == [ENDPOINT, ENDPOINT + "/expirada"]
    assert sent[0][1]["title"] == "ClimaSP: risco ALTO em Santana"
    assert ENDPOINT + "/expirada" not in remaining  # 410: removida (LGPD e higiene)


def test_rotas_de_inscricao_push(client, channels_on):
    asyncio.run(_reset())
    ch = client.get("/api/v1/alerts/channels").json()
    assert ch["web_push"] is True and ch["vapid_public_key"] == "BPUB" and ch["whatsapp"] is True
    body = {"subscription": {"endpoint": ENDPOINT, "keys": KEYS}, "regions": ["st", "MG", "XX"], "min_level": "critical"}
    resp = client.post("/api/v1/alerts/push/subscribe", json=body)
    assert resp.status_code == 201 and resp.json() == {"regions": ["MG", "ST"], "min_level": "critical"}
    bad = {**body, "subscription": {"endpoint": "http://inseguro.test/x", "keys": KEYS}}
    assert client.post("/api/v1/alerts/push/subscribe", json=bad).status_code == 422
    assert client.post("/api/v1/alerts/push/unsubscribe", json={"endpoint": ENDPOINT}).json() == {"deleted": True}


def test_sem_vapid_a_inscricao_explica_o_que_falta(client, monkeypatch):
    for k in ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"):
        monkeypatch.delenv(k, raising=False)
    get_settings.cache_clear()
    resp = client.post("/api/v1/alerts/push/subscribe", json={"subscription": {"endpoint": ENDPOINT, "keys": KEYS}, "regions": ["ST"]})
    assert resp.status_code == 503 and "VAPID" in resp.json()["detail"]
    assert client.get("/api/v1/alerts/channels").json()["web_push"] is False
    get_settings.cache_clear()


@pytest.mark.parametrize(("text", "expected"), [
    ("SAIR", {"action": "stop"}),
    ("parar", {"action": "stop"}),
    ("Jaçanã", {"action": "subscribe", "regions": ["JT"], "min_level": "high"}),
    ("alertas santana e vila maria", {"action": "subscribe", "regions": ["MG", "ST"], "min_level": "high"}),
    ("todas crítico", {"action": "subscribe", "regions": ["CV", "JT", "MG", "ST"], "min_level": "critical"}),
    ("oi", {"action": "help"}),
])
def test_comandos_do_whatsapp(text, expected):
    assert alert_service.parse_command(text) == expected


def _signed(body: dict, secret: str = "segredo") -> tuple[bytes, str]:
    raw = json.dumps(body).encode()
    return raw, "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def _message(wa_id: str, text: str) -> dict:
    return {"entry": [{"changes": [{"value": {"messages": [{"from": wa_id, "type": "text", "text": {"body": text}}]}}]}]}


def test_webhook_whatsapp_verifica_assinatura_inscreve_e_cancela(client, channels_on, whatsapp_calls):
    asyncio.run(_reset())
    ok = client.get("/api/v1/alerts/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verifica", "hub.challenge": "42"})
    assert ok.status_code == 200 and ok.text == "42"
    assert client.get("/api/v1/alerts/whatsapp/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1"}).status_code == 403

    raw, sig = _signed(_message("5511999990000", "Santana"))
    assert client.post("/api/v1/alerts/whatsapp/webhook", content=raw, headers={"X-Hub-Signature-256": "sha256=errada"}).status_code == 401
    assert client.post("/api/v1/alerts/whatsapp/webhook", content=raw, headers={"X-Hub-Signature-256": sig}).json() == {"handled": 1}
    assert "Santana" in whatsapp_calls[-1]["body"]["text"]["body"]
    assert whatsapp_calls[-1]["auth"] == "Bearer tok" and whatsapp_calls[-1]["url"].endswith("/123/messages")

    async def subscribers():
        async with AsyncSessionLocal() as s:
            return [(w.wa_id, w.regions) for w in (await s.scalars(select(WhatsAppSubscriber))).all()]

    assert asyncio.run(subscribers()) == [("5511999990000", "ST")]
    raw, sig = _signed(_message("5511999990000", "sair"))
    client.post("/api/v1/alerts/whatsapp/webhook", content=raw, headers={"X-Hub-Signature-256": sig})
    assert asyncio.run(subscribers()) == []  # SAIR apaga o número


def test_ciclo_completo_dispara_os_dois_canais_e_registra(channels_on, whatsapp_calls, monkeypatch):
    monkeypatch.setattr(alert_service, "push_sender", lambda sub, payload: 201)

    async def scenario():
        await _reset()
        async with AsyncSessionLocal() as s:
            await alert_service.save_push_subscription(s, endpoint=ENDPOINT, regions=["CV"], min_level="high", **KEYS)
            s.add(WhatsAppSubscriber(wa_id="5511988887777", regions="CV,ST", min_level="high", consent_at=alert_service._now()))
            await s.commit()
            await alert_service.run_cycle(s, {"CV": region("low")})
            events = await alert_service.run_cycle(s, {"CV": region("critical", 45.0)})
            logs = [(l.channel, l.level, l.delivered) for l in (await s.scalars(select(AlertLog))).all()]
        return events, logs

    events, logs = asyncio.run(scenario())
    assert [e["level"] for e in events] == ["critical"]
    assert sorted(logs) == [("web_push", "critical", 1), ("whatsapp", "critical", 1)]
    template = whatsapp_calls[-1]["body"]["template"]
    assert template["name"] == "alerta_alagamento" and template["language"]["code"] == "pt_BR"
    assert [p["text"] for p in template["components"][0]["parameters"]] == ["CRÍTICO", "Casa Verde", "chuva de 45,0 mm/h"]
