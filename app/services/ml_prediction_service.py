from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.ml import dataset
from app.ml.features import FEATURE_COLUMNS, build_features, build_training_frame, regularize_hourly
from app.ml.model import FloodRiskModel, sklearn_available
from app.ml.risk import combine_flood_risk
from app.models.model_run import ModelRun
from app.repositories.observation_repository import ObservationRepository
from app.services.storage_service import StorageService

if TYPE_CHECKING:
    import httpx
    import pandas as pd

# Histórico mínimo antes da hora prevista para calcular todas as janelas (rain_168h).
_CONTEXT_HOURS = 7 * 24 + 6


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _hour(dt: datetime) -> datetime:
    return _utc(dt).replace(minute=0, second=0, microsecond=0)


class MLPredictionService:
    """Pipeline de ML com dados reais: ingestão → treino → inferência.

    1. Ingestão: baixa a série horária histórica real (Open-Meteo Archive/ERA5) de cada região
       e mantém as últimas horas atualizadas (Forecast API com `past_days`). Tudo é gravado em
       `hourly_observations` (upsert idempotente).
    2. Treino: monta features físicas sem vazamento, alvo = chuva forte nas próximas H horas,
       avaliação com divisão temporal e baselines; registra cada execução em `model_runs`.
    3. Inferência: probabilidade de chuva forte + chuva esperada para "agora" e para cada
       hora da previsão, combinadas com a chuva já observada num índice de risco 0–100.

    Sem modelo treinado (ou sem scikit-learn) retorna None e o WeatherService usa a heurística.
    """

    def __init__(
        self,
        storage: StorageService,
        session_factory: async_sessionmaker[AsyncSession] | None = None,
        model_path: Path | None = None,
        observations: ObservationRepository | None = None,
    ) -> None:
        self.storage = storage
        self.session_factory = session_factory
        self.settings = get_settings()
        self.observations = observations or ObservationRepository()
        self._model = FloodRiskModel(model_path=model_path or Path(self.settings.ml_model_path))
        self._forecast_cache: dict[str, list[dataset.HourlyRecord]] = {}
        self._train_lock = asyncio.Lock()
        self._job: dict = {"state": "idle", "stage": None, "started_at": None, "finished_at": None, "error": None}
        self._last_sync_at: datetime | None = None
        self._last_sync_error: str | None = None

    # ── Ciclo de vida do modelo ────────────────────────────────────────────────

    def try_load(self) -> bool:
        return self._model.load()

    @property
    def model_available(self) -> bool:
        return self._model.is_loaded

    @property
    def training_running(self) -> bool:
        return self._train_lock.locked()

    # ── Ingestão de dados reais ────────────────────────────────────────────────

    async def ingest_history(
        self,
        session: AsyncSession,
        *,
        years: int | None = None,
        client: "httpx.AsyncClient | None" = None,
        today: date | None = None,
    ) -> dict:
        """Baixa (incrementalmente) o histórico ERA5 de todas as regiões e grava no banco."""
        years = years or self.settings.ml_training_history_years
        start, end = dataset.archive_window(years, today=today)
        regions = await self.storage.list_regions(session)

        owns_client = client is None
        client = client or dataset.new_http_client()
        summary: dict[str, dict] = {}
        try:
            for region in regions:
                earliest = await self.observations.earliest(session, region.code)
                latest_archive = await self.observations.latest_by_source(
                    session, region.code, "open-meteo-archive"
                )
                ranges: list[tuple[date, date]] = []
                if earliest is None or earliest.date() > start:
                    ranges.append((start, (earliest.date() - timedelta(days=1)) if earliest else end))
                if latest_archive is not None and latest_archive.date() < end:
                    ranges.append((latest_archive.date(), end))

                inserted = 0
                for range_start, range_end in ranges:
                    if range_start > range_end:
                        continue
                    records = await dataset.fetch_archive(
                        client,
                        region_code=region.code,
                        latitude=region.latitude,
                        longitude=region.longitude,
                        start_date=range_start,
                        end_date=range_end,
                    )
                    inserted += await self.observations.upsert_many(session, records)
                summary[region.code] = {"hours_upserted": inserted, "ranges": [[a.isoformat(), b.isoformat()] for a, b in ranges]}
        finally:
            if owns_client:
                await client.aclose()

        recent = await self.sync_recent(session, client=None if owns_client else client)
        return {"archive_window": [start.isoformat(), end.isoformat()], "regions": summary, "recent": recent}

    async def sync_recent(
        self,
        session: AsyncSession,
        *,
        client: "httpx.AsyncClient | None" = None,
        now: datetime | None = None,
    ) -> dict:
        """Atualiza as últimas horas observadas (e guarda em memória as próximas horas previstas).

        Cobre o atraso de ~5 dias da Archive API, garantindo janelas completas para inferência.
        """
        now = _utc(now or datetime.now(tz=timezone.utc))
        regions = await self.storage.list_regions(session)
        owns_client = client is None
        client = client or dataset.new_http_client()
        result: dict[str, int | str] = {}
        try:
            for region in regions:
                latest = await self.observations.latest_by_source(session, region.code)
                gap_days = (now - latest).days + 1 if latest else dataset.ARCHIVE_DELAY_DAYS + 3
                past_days = max(dataset.ARCHIVE_DELAY_DAYS + 3, min(dataset.FORECAST_MAX_PAST_DAYS, gap_days))
                try:
                    past, future = await dataset.fetch_recent_and_forecast(
                        client,
                        region_code=region.code,
                        latitude=region.latitude,
                        longitude=region.longitude,
                        past_days=past_days,
                        now=now,
                    )
                except RuntimeError as exc:
                    result[region.code] = f"erro: {exc}"
                    continue
                # Nunca sobrescrevemos a reanálise (ERA5) com a análise operacional.
                archive_end = await self.observations.latest_by_source(session, region.code, "open-meteo-archive")
                if archive_end is not None:
                    past = [r for r in past if r.observed_at > archive_end]
                result[region.code] = await self.observations.upsert_many(session, past)
                self._forecast_cache[region.code] = future
        finally:
            if owns_client:
                await client.aclose()

        errors = [f"{code}: {v}" for code, v in result.items() if isinstance(v, str)]
        self._last_sync_at = datetime.now(tz=timezone.utc)
        self._last_sync_error = " | ".join(errors) or None
        return result

    # ── Treino ────────────────────────────────────────────────────────────────

    async def train(
        self,
        session: AsyncSession | None = None,
        *,
        years: int | None = None,
        ingest: bool = True,
        trigger: str = "api",
    ) -> dict:
        """Coleta (incremental) + treina + persiste. Retorna os metadados/métricas do modelo."""
        if not sklearn_available():
            raise RuntimeError("scikit-learn não está instalado — instale requirements.txt.")
        if self._train_lock.locked():
            raise RuntimeError("Treino já em execução.")

        async with self._train_lock:
            if session is None:
                if self.session_factory is None:
                    raise RuntimeError("Sem sessão de banco para treinar.")
                async with self.session_factory() as own_session:
                    return await self._train_locked(own_session, years=years, ingest=ingest, trigger=trigger)
            return await self._train_locked(session, years=years, ingest=ingest, trigger=trigger)

    async def _train_locked(self, session: AsyncSession, *, years: int | None, ingest: bool, trigger: str) -> dict:
        self._job = {
            "state": "running",
            "stage": "coletando dados",
            "started_at": datetime.now(tz=timezone.utc),
            "finished_at": None,
            "error": None,
        }
        run = ModelRun(started_at=self._job["started_at"], status="running", trigger=trigger)
        session.add(run)
        await session.commit()

        try:
            if ingest:
                await self.ingest_history(session, years=years)

            self._job["stage"] = "montando features"
            raw = await self.observations.load_frame(session)
            if raw.empty:
                raise RuntimeError("Nenhuma observação no banco. Execute a ingestão de dados primeiro.")
            sources = sorted(raw["source"].dropna().unique().tolist())

            horizon = self.settings.ml_horizon_hours
            loop = asyncio.get_running_loop()
            data, threshold = await loop.run_in_executor(None, self._prepare_training_data, raw, horizon)

            self._job["stage"] = "treinando modelo"
            metadata = await loop.run_in_executor(
                None,
                lambda: self._model.train(
                    data, horizon_hours=horizon, heavy_rain_mm=threshold, data_sources=sources
                ),
            )

            run.status = "success"
            run.model_version = metadata["version"]
            run.samples = metadata["samples"]
            run.metrics_json = json.dumps(metadata["metrics"], ensure_ascii=False)
            self._job.update(state="success", stage=None)
            return metadata
        except Exception as exc:
            await session.rollback()
            run.status = "failed"
            run.error = str(exc)[:4000]
            self._job.update(state="failed", error=str(exc))
            raise
        finally:
            run.finished_at = datetime.now(tz=timezone.utc)
            self._job["finished_at"] = run.finished_at
            await session.commit()

    def _prepare_training_data(self, raw: "pd.DataFrame", horizon: int) -> tuple["pd.DataFrame", float]:
        """Monta o dataset; se o limiar configurado gerar poucos eventos, relaxa-o de forma explícita.

        A reanálise ERA5 (~9–25 km) suaviza picos convectivos, então eventos de 10 mm/3h podem ser
        raros num ponto de grade. O limiar efetivamente usado fica registrado nos metadados.
        """
        configured = float(self.settings.ml_heavy_rain_mm)
        candidates = [configured] + [t for t in (7.5, 5.0, 3.0) if t < configured]
        last = None
        for threshold in candidates:
            data = build_training_frame(raw.drop(columns=["source"]), horizon, threshold)
            positives = int(data["target_heavy"].sum()) if not data.empty else 0
            last = (data, threshold, positives)
            if positives >= self.settings.ml_min_positive_samples:
                return data, threshold
        data, threshold, positives = last  # type: ignore[misc]
        raise RuntimeError(
            f"Apenas {positives} eventos de chuva forte (>= {threshold} mm/{horizon}h) em "
            f"{len(data)} horas de dados. Aumente ML_TRAINING_HISTORY_YEARS."
        )

    # ── Inferência ────────────────────────────────────────────────────────────

    async def _region_frame(self, session: AsyncSession, region_code: str, include_forecast: bool) -> "pd.DataFrame":
        import pandas as pd

        since = datetime.now(tz=timezone.utc) - timedelta(hours=_CONTEXT_HOURS + 24)
        history = await self.observations.load_frame(session, region_code=region_code, since=since)
        frames = [history.drop(columns=["region_code", "source"]).assign(is_forecast=0.0)] if not history.empty else []
        if include_forecast and self._forecast_cache.get(region_code):
            last_obs = history["observed_at"].max() if not history.empty else None
            future = [
                {"observed_at": r.observed_at, "is_forecast": 1.0, **r.values}
                for r in self._forecast_cache[region_code]
                if last_obs is None or r.observed_at > last_obs
            ]
            if future:
                frames.append(pd.DataFrame(future))
        if not frames:
            return pd.DataFrame()
        combined = pd.concat(frames, ignore_index=True)
        return build_features(regularize_hourly(combined))

    async def predict_region(self, session: AsyncSession, region_code: str, *, include_forecast: bool = True) -> dict | None:
        """Nowcast da região + risco por hora da previsão. None se não houver modelo/dados."""
        if not self.model_available:
            return None
        region_code = region_code.upper()
        frame = await self._region_frame(session, region_code, include_forecast)
        if frame.empty:
            return None

        now_hour = _hour(datetime.now(tz=timezone.utc))
        observed_mask = frame["observed_at"] <= now_hour
        if not observed_mask.any():
            return None

        valid = frame.dropna(subset=["precip_1h"])
        loop = asyncio.get_running_loop()
        proba, expected = await loop.run_in_executor(None, self._model.predict, valid)
        valid = valid.assign(p_heavy=proba, expected_mm=expected)
        valid["risk"] = [
            combine_flood_risk(
                heavy_rain_probability=row.p_heavy,
                rain_1h=row.precip_1h,
                rain_3h=row.rain_3h,
                rain_24h=row.rain_24h,
            )
            for row in valid.itertuples()
        ]

        current_rows = valid[valid["observed_at"] <= now_hour]
        if current_rows.empty:
            return None
        current = current_rows.iloc[-1]
        meta = self._model.metadata
        threshold = meta.get("metrics", {}).get("decision_threshold", 0.5)

        timeline = [
            {
                "time": _utc(row.observed_at.to_pydatetime()),
                "kind": "forecast" if row.is_forecast == 1.0 else "observed",
                "rain_mm": round(float(row.precip_1h), 2),
                "heavy_rain_probability": round(float(row.p_heavy), 4),
                "expected_rain_next_mm": round(float(row.expected_mm), 2),
                "risk": int(row.risk),
            }
            for row in valid[valid["observed_at"] >= now_hour - timedelta(hours=24)].itertuples()
        ]

        return {
            "region": region_code,
            "as_of": _utc(current["observed_at"].to_pydatetime()),
            "model_version": meta.get("version"),
            "horizon_hours": meta.get("horizon_hours"),
            "heavy_rain_mm": meta.get("heavy_rain_mm"),
            "heavy_rain_probability": round(float(current["p_heavy"]), 4),
            "heavy_rain_alert": bool(current["p_heavy"] >= threshold),
            "decision_threshold": round(float(threshold), 4),
            "expected_rain_next_mm": round(float(current["expected_mm"]), 2),
            "observed": {
                "rain_1h_mm": round(float(current["precip_1h"]), 2),
                "rain_3h_mm": round(float(current["rain_3h"]), 2),
                "rain_24h_mm": round(float(current["rain_24h"]), 2),
                "rain_72h_mm": round(float(current["rain_72h"]), 2),
                "pressure_tend_3h_hpa": None if _isnan(current["pressure_tend_3h"]) else round(float(current["pressure_tend_3h"]), 2),
            },
            "risk": int(current["risk"]),
            "timeline": timeline,
        }

    async def risk_for_region(self, session: AsyncSession, region_code: str) -> tuple[int, dict[datetime, int]] | None:
        """(risco atual, risco por hora prevista) para o WeatherService. None = usar heurística."""
        try:
            prediction = await self.predict_region(session, region_code)
        except Exception as exc:  # pragma: no cover - defensivo: inferência nunca derruba a API
            print(f"[ML] Falha na inferência de {region_code}: {exc}")
            return None
        if prediction is None:
            return None
        now_hour = _hour(datetime.now(tz=timezone.utc))
        by_hour = {_hour(p["time"]): p["risk"] for p in prediction["timeline"] if p["time"] > now_hour}
        return prediction["risk"], by_hour

    # ── Observabilidade ───────────────────────────────────────────────────────

    async def recent_runs(self, session: AsyncSession, limit: int = 10) -> list[dict]:
        rows = await session.scalars(select(ModelRun).order_by(ModelRun.id.desc()).limit(limit))
        return [
            {
                "id": r.id,
                "started_at": _utc(r.started_at),
                "finished_at": _utc(r.finished_at) if r.finished_at else None,
                "status": r.status,
                "trigger": r.trigger,
                "model_version": r.model_version,
                "samples": r.samples,
                "metrics": json.loads(r.metrics_json) if r.metrics_json else None,
                "error": r.error,
            }
            for r in rows
        ]

    def status(self) -> dict:
        return {
            "model_available": self.model_available,
            "sklearn_available": sklearn_available(),
            "model_path": str(self._model.model_path),
            "model_file_exists": self._model.model_path.exists(),
            "model": {k: v for k, v in self._model.metadata.items() if k not in {"metrics", "feature_importance", "feature_columns"}},
            "train_metrics": self._model.train_metrics,
            "feature_importance": self._model.feature_importance,
            "feature_columns": FEATURE_COLUMNS,
            "training_job": dict(self._job),
            "last_sync_at": self._last_sync_at,
            "last_sync_error": self._last_sync_error,
        }

    # ── Jobs agendados ────────────────────────────────────────────────────────

    async def scheduled_sync(self) -> None:
        if self.session_factory is None:
            return
        try:
            async with self.session_factory() as session:
                await self.sync_recent(session)
        except Exception as exc:
            self._last_sync_error = str(exc)
            print(f"[ML] Erro ao sincronizar observações recentes: {exc}")

    async def scheduled_retrain(self, trigger: str = "scheduler") -> None:
        if self.training_running:
            return
        try:
            metadata = await self.train(trigger=trigger)
            print(f"[ML] Modelo {metadata['version']} treinado — ROC-AUC {metadata['metrics']['roc_auc']:.3f}")
        except Exception as exc:
            print(f"[ML] Falha no treino ({trigger}): {exc}")

    async def bootstrap(self) -> None:
        """Na inicialização: sincroniza horas recentes e, se não houver modelo, coleta + treina."""
        await self.scheduled_sync()
        if not self.model_available and self.settings.ml_auto_bootstrap and sklearn_available():
            await self.scheduled_retrain(trigger="bootstrap")


def _isnan(value: object) -> bool:
    try:
        return value != value  # noqa: PLR0124 — NaN != NaN
    except Exception:
        return False
