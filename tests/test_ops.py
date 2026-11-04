"""Fase 3: perfis de acesso, equipes de exemplo, ciclo da ocorrência e relatório pós-evento."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.core.config import get_settings
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.models.hourly_observation import HourlyObservation
from app.models.ops import Incident, IncidentEvent, NowcastLog, Team
from app.services import ops_service
from app.services.storage_service import StorageService


@pytest.fixture()
def tokens(monkeypatch):
    monkeypatch.setenv("OPERATOR_TOKEN", "op-teste")
    monkeypatch.setenv("MANAGER_TOKEN", "gestor-teste")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture()
def client():
    from app.main import app
    return TestClient(app)


def test_ops_without_tokens_is_disabled(client, monkeypatch):
    monkeypatch.delenv("OPERATOR_TOKEN", raising=False)
    monkeypatch.delenv("MANAGER_TOKEN", raising=False)
    get_settings.cache_clear()
    resp = client.get("/api/v1/ops/me", headers={"Authorization": "Bearer qualquer"})
    assert resp.status_code == 503
    assert "OPERATOR_TOKEN" in resp.json()["detail"]
    get_settings.cache_clear()


def test_roles(client, tokens):
    assert client.get("/api/v1/ops/me").status_code == 401
    assert client.get("/api/v1/ops/me", headers={"Authorization": "Bearer errado"}).status_code == 401
    assert client.get("/api/v1/ops/me", headers={"Authorization": "Bearer op-teste"}).json() == {"role": "operador"}
    assert client.get("/api/v1/ops/me", headers={"Authorization": "Bearer gestor-teste"}).json() == {"role": "gestor"}
    # gestor só lê: não pode abrir ocorrência
    resp = client.post("/api/v1/ops/incidents", json={"lat": -23.49, "lng": -46.62},
                       headers={"Authorization": "Bearer gestor-teste"})
    assert resp.status_code == 403


def test_example_teams_are_labelled_and_based_on_real_facilities():
    teams = ops_service.example_teams()
    kinds = {t["kind"] for t in teams}
    assert kinds == {"defesa_civil", "bombeiros", "cet", "samu", "subprefeitura"}
    assert all(t["name"].startswith("[EXEMPLO]") for t in teams)
    bombeiros = [t for t in teams if t["kind"] == "bombeiros"]
    assert bombeiros and all("OpenStreetMap" in t["base_source"] for t in bombeiros)


def test_region_at_uses_the_hex_grid():
    assert ops_service.region_at(-23.4985, -46.629) == "ST"
    assert ops_service.region_at(-23.5614, -46.6559) is None  # Av. Paulista, fora da área


def test_incident_lifecycle_and_report():
    asyncio.run(_lifecycle())


async def _lifecycle():
    await init_db()
    async with AsyncSessionLocal() as session:
        await StorageService().seed_regions(session)
        for model in (IncidentEvent, Incident, Team, NowcastLog):
            await session.execute(delete(model))
        await session.commit()
        created = await ops_service.seed_example_teams(session)
        assert created > 10
        assert await ops_service.seed_example_teams(session) == 0  # idempotente

        teams = await ops_service.list_teams(session)
        team = next(t for t in teams if t["kind"] == "defesa_civil")
        inc = await ops_service.open_incident(session, lat=-23.4985, lng=-46.629, kind="alagamento",
                                              description="Rua alagada", address="Rua Voluntários da Pátria", role="operador")
        assert inc["region"] == "ST" and inc["status"] == "aberta"

        inc = await ops_service.assign_team(session, inc["id"], team["id"], eta_minutes=7, role="operador")
        assert inc["status"] == "despachada" and inc["eta_minutes"] == 7
        busy = next(t for t in await ops_service.list_teams(session) if t["id"] == team["id"])
        assert busy["status"] == "em_deslocamento"

        other = await ops_service.open_incident(session, lat=-23.49, lng=-46.66, kind="alagamento", description="",
                                                address="", role="operador")
        with pytest.raises(ops_service.ConflictError):  # equipe ocupada não pode ser despachada de novo
            await ops_service.assign_team(session, other["id"], team["id"], eta_minutes=None, role="operador")

        inc = await ops_service.arrive(session, inc["id"], role="operador")
        assert inc["status"] == "no_local"
        inc = await ops_service.resolve(session, inc["id"], note="Água baixou", role="operador")
        assert inc["status"] == "resolvida"
        assert [e["kind"] for e in inc["timeline"]] == ["aberta", "equipe_designada", "no_local", "resolvida"]
        back = next(t for t in await ops_service.list_teams(session) if t["id"] == team["id"])
        assert back["status"] == "disponivel"

        # acerto do modelo: um alerta que se confirmou e um silêncio em que choveu forte
        now = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
        t0 = now - timedelta(hours=8)
        await ops_service.log_nowcast(session, "ST", {"as_of": t0, "heavy_rain_probability": 0.4, "heavy_rain_alert": True,
                                                      "heavy_rain_mm": 10, "horizon_hours": 3})
        await ops_service.log_nowcast(session, "CV", {"as_of": t0, "heavy_rain_probability": 0.01, "heavy_rain_alert": False,
                                                      "heavy_rain_mm": 10, "horizon_hours": 3})
        await ops_service.log_nowcast(session, "ST", {"as_of": t0, "heavy_rain_probability": 0.9, "heavy_rain_alert": True,
                                                      "heavy_rain_mm": 10, "horizon_hours": 3})  # duplicado: ignorado
        await session.execute(delete(HourlyObservation).where(HourlyObservation.observed_at > t0))
        for code in ("ST", "CV"):
            for h in range(1, 4):
                session.add(HourlyObservation(region_code=code, observed_at=t0 + timedelta(hours=h), precipitation_mm=5.0,
                                              source="teste"))
        await session.commit()

        rep = await ops_service.report(session, hours=24)
    assert rep["incidents"]["total"] == 2
    assert rep["incidents"]["by_status"]["resolvida"] == 1
    assert rep["incidents"]["mean_minutes_to_dispatch"] is not None
    assert rep["rain"]["ST"]["total_mm"] >= 15
    model = rep["model"]
    assert model["evaluated"] == 2
    assert (model["true_positive"], model["false_negative"]) == (1, 1)
    assert model["precision"] == 1.0 and model["recall"] == 0.5


def test_example_bases_file_matches_backend_teams():
    """data/geo/example-bases.json (usado no cálculo de cobertura) precisa refletir example_teams()."""
    import json
    from pathlib import Path

    data = json.loads((Path(__file__).resolve().parent.parent / "data/geo/example-bases.json").read_text(encoding="utf-8"))
    keys = {b["key"] for b in data["bases"]}
    expected = {f"{t['lat']:.5f},{t['lng']:.5f}" for t in ops_service.example_teams()}
    assert keys == expected, "regenere data/geo/example-bases.json (ver README, Fase 3)"


def test_dev_client_log_is_off_by_default_and_writes_when_enabled(client, monkeypatch, tmp_path):
    from app.controllers import dev_controller

    monkeypatch.delenv("DEV_CLIENT_LOG", raising=False)
    get_settings.cache_clear()
    entry = {"level": "error", "message": "TypeError: x is undefined", "source": "js/map.js:10:5", "url": "http://localhost:8000/"}
    assert client.post("/api/v1/dev/client-log", json=entry).status_code == 404

    monkeypatch.setenv("DEV_CLIENT_LOG", "true")
    monkeypatch.setattr(dev_controller, "LOG_FILE", tmp_path / "client.log")
    get_settings.cache_clear()
    assert client.post("/api/v1/dev/client-log", json=entry).status_code == 204
    assert "TypeError: x is undefined" in (tmp_path / "client.log").read_text(encoding="utf-8")
    get_settings.cache_clear()
