"""Critério único de nível, tendência e painel agregado (/weather/overview)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.core.risk_levels import level_from_rain, level_from_risk, trend, unified_level
from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal, engine
from app.models.forecast_reading import ForecastReading
from app.models.weather_reading import WeatherReading
from app.services.storage_service import StorageService
from app.services.weather_service import WeatherService
from app.views.weather_views import OverviewResponse

NOW = datetime.now(tz=timezone.utc)


@pytest.mark.parametrize(
    ("rain", "expected"),
    [(0, "low"), (4.9, "low"), (5, "medium"), (19.9, "medium"), (20, "high"), (39.9, "high"), (40, "critical")],
)
def test_level_from_rain_uses_official_thresholds(rain, expected):
    assert level_from_rain(rain) == expected


@pytest.mark.parametrize(("risk", "expected"), [(0, "low"), (24, "low"), (25, "medium"), (50, "high"), (75, "critical")])
def test_level_from_risk_cuts(risk, expected):
    assert level_from_risk(risk) == expected


def test_unified_level_is_the_worst_of_rain_and_model_risk():
    # chuva fraca, mas acumulado/modelo alto → sobe pelo risco
    assert unified_level(3.0, 80, "ml")["level"] == "critical"
    assert "risco combinado" in unified_level(3.0, 80, "ml")["reason"]
    # chuva forte, risco baixo → vale a chuva
    assert unified_level(25.0, 10, "ml") == {"level": "high", "label": "Alto", "reason": "chuva observada na última hora"}


def test_heuristic_risk_never_raises_the_level():
    # sem modelo, o índice heurístico dá ~40 pontos com umidade alta e nenhuma chuva
    assert unified_level(0.0, 40, "heuristic")["level"] == "low"
    assert unified_level(0.0, 90, None)["level"] == "low"
    assert unified_level(21.0, 90, "heuristic")["level"] == "high"


def _series(values, step_min=10):
    start = NOW - timedelta(minutes=step_min * (len(values) - 1))
    return [(start + timedelta(minutes=step_min * i), v) for i, v in enumerate(values)]


def test_trend_rising_reports_when_it_started():
    pts = _series([2, 2, 1, 1, 3, 5, 5, 8])
    out = trend(pts, min_delta=0.5)
    assert out["direction"] == "up"
    assert out["since"] == pts[3][0]  # último ponto no mínimo antes da subida
    assert out["delta"] == 7


def test_trend_falling_and_flat():
    assert trend(_series([9, 7, 7, 4]), min_delta=0.5)["direction"] == "down"
    assert trend(_series([3, 3.2, 3.1, 3.3]), min_delta=0.5)["direction"] == "flat"
    assert trend([], min_delta=0.5)["direction"] == "flat"


def test_additive_migration_adds_risk_source_to_existing_tables():
    async def run():
        await init_db()
        async with engine.begin() as conn:
            await conn.execute(text("DROP TABLE IF EXISTS legacy_probe"))
            cols = await conn.run_sync(lambda c: [r[1] for r in c.exec_driver_sql("PRAGMA table_info(weather_readings)")])
        assert "risk_source" in cols

    asyncio.run(run())


def test_overview_builds_series_trend_and_levels():
    asyncio.run(_overview())


async def _overview():
    await init_db()
    storage = StorageService()
    service = WeatherService(providers=[], storage=storage, ml_service=None)
    async with AsyncSessionLocal() as session:
        await storage.seed_regions(session)
        await session.execute(text("DELETE FROM weather_readings"))
        await session.execute(text("DELETE FROM forecast_readings"))
        # Santana: chuva subindo nos últimos 40 min; risco do modelo alto
        for minutes, rain, risk in [(60, 1.0, 20), (40, 1.0, 22), (30, 6.0, 40), (20, 12.0, 55), (10, 18.0, 70), (0, 22.0, 80)]:
            session.add(WeatherReading(
                region_code="ST", temperature_c=22, humidity_percent=90, rain_mm=rain, wind_kmh=10,
                flood_risk_index=risk, risk_source="ml", source="teste", recorded_at=NOW - timedelta(minutes=minutes),
            ))
        # Casa Verde: leitura antiga, sem origem registrada
        session.add(WeatherReading(
            region_code="CV", temperature_c=22, humidity_percent=95, rain_mm=0.0, wind_kmh=10,
            flood_risk_index=45, risk_source=None, source="teste", recorded_at=NOW - timedelta(minutes=5),
        ))
        for h in range(1, 4):
            session.add(ForecastReading(
                region_code="ST", forecast_for=NOW + timedelta(hours=h), temperature_c=21, humidity_percent=92,
                rain_mm=45.0 if h == 2 else 3.0, wind_kmh=12, flood_risk_index=60, risk_source="ml",
                source="teste", generated_at=NOW,
            ))
        await session.commit()

        data = await service.get_overview(session)

    parsed = OverviewResponse(**data)  # contrato do endpoint
    st = parsed.regions["ST"]
    assert st.level == "critical"  # risco 80 do modelo
    assert st.risk_source == "ml"
    assert st.trend["rain"].direction == "up"
    assert st.trend["rain"].since is not None
    kinds = [p.kind for p in st.series]
    assert "observed" in kinds and "forecast" in kinds
    assert any(p.kind == "forecast" and p.level == "critical" for p in st.series)  # 45 mm/h previstos
    assert len(st.recent) == 6

    cv = parsed.regions["CV"]
    assert cv.risk_source == "unknown"
    assert cv.level == "low"  # índice sem origem conhecida não sobe o nível
    assert parsed.thresholds.risk_cuts == {"medium": 25, "high": 50, "critical": 75}
    assert parsed.model == {"available": False}
