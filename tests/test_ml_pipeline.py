from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import func, select

from app.db.init_db import init_db
from app.db.session import AsyncSessionLocal
from app.ml.risk import combine_flood_risk
from app.models.hourly_observation import HourlyObservation
from app.services.ml_prediction_service import MLPredictionService
from app.services.storage_service import StorageService
from tests.fake_open_meteo import FakeOpenMeteo


def test_combine_flood_risk_is_monotonic_union():
    assert combine_flood_risk(heavy_rain_probability=0.0, rain_1h=0, rain_3h=0, rain_24h=0) == 0
    assert combine_flood_risk(heavy_rain_probability=0.5, rain_1h=0, rain_3h=0, rain_24h=0) == 50
    assert combine_flood_risk(heavy_rain_probability=0.0, rain_1h=40, rain_3h=40, rain_24h=40) == 100
    assert combine_flood_risk(heavy_rain_probability=0.5, rain_1h=0, rain_3h=30, rain_24h=0) == 75


def test_end_to_end_ingest_train_predict(tmp_path):
    asyncio.run(_end_to_end(tmp_path))


async def _end_to_end(tmp_path):
    fake = FakeOpenMeteo(now=datetime.now(tz=timezone.utc))
    await init_db()
    storage = StorageService()
    ml = MLPredictionService(storage=storage, session_factory=AsyncSessionLocal, model_path=tmp_path / "m.joblib")

    async with AsyncSessionLocal() as session:
        await storage.seed_regions(session)

        async with fake.client() as client:
            summary = await ml.ingest_history(session, years=2, client=client)
        assert set(summary["regions"]) == {"CV", "JT", "MG", "ST"}
        total = await session.scalar(select(func.count(HourlyObservation.id)))
        assert total > 4 * 2 * 8700

        # Ingestão é incremental e idempotente.
        calls_before = len(fake.calls)
        async with fake.client() as client:
            again = await ml.ingest_history(session, years=2, client=client)
        assert all(not r["ranges"] for r in again["regions"].values())
        assert await session.scalar(select(func.count(HourlyObservation.id))) == total
        assert len(fake.calls) - calls_before == 4  # só a sincronização recente

        meta = await ml.train(session, ingest=False, trigger="test")

    m = meta["metrics"]
    assert meta["horizon_hours"] == 3
    assert m["test_samples"] > 1000
    # O modelo precisa superar os baselines no período de teste (dados nunca vistos).
    assert m["roc_auc"] > 0.85
    assert m["roc_auc"] > m["baseline"]["persistence_roc_auc"]
    assert m["pr_auc"] > m["baseline"]["persistence_pr_auc"]
    assert m["brier_skill_vs_climatology"] > 0.1
    assert m["rain_mae_mm"] < m["baseline"]["zero_rain_mae_mm"]
    top = list(meta["feature_importance"])[:6]
    assert any(name.startswith(("pressure", "cloud", "humidity", "dew")) for name in top)

    # Recarrega do disco como faria a API no boot.
    reloaded = MLPredictionService(storage=storage, session_factory=AsyncSessionLocal, model_path=tmp_path / "m.joblib")
    assert reloaded.try_load()
    assert reloaded.status()["model"]["version"] == meta["version"]

    async with AsyncSessionLocal() as session:
        async with fake.client() as client:
            await reloaded.sync_recent(session, client=client)
        prediction = await reloaded.predict_region(session, "cv")
        risk = await reloaded.risk_for_region(session, "CV")
        runs = await ml.recent_runs(session)

    assert prediction is not None
    assert 0.0 <= prediction["heavy_rain_probability"] <= 1.0
    assert 0 <= prediction["risk"] <= 100
    kinds = {p["kind"] for p in prediction["timeline"]}
    assert kinds == {"observed", "forecast"}
    assert risk is not None and len(risk[1]) >= 24
    assert runs[0]["status"] == "success" and runs[0]["trigger"] == "test"
