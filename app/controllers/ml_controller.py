from __future__ import annotations

import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_ml_prediction_service
from app.db.session import get_db
from app.services.ml_prediction_service import MLPredictionService

router = APIRouter(prefix="/ml", tags=["Machine Learning"])

_background_tasks: set[asyncio.Task] = set()


class TrainResponse(BaseModel):
    message: str
    metadata: dict | None = None


class MLStatusResponse(BaseModel):
    model_available: bool
    sklearn_available: bool
    model_path: str
    model_file_exists: bool
    model: dict
    train_metrics: dict
    feature_importance: dict[str, float]
    feature_columns: list[str]
    training_job: dict
    last_sync_at: datetime | None
    last_sync_error: str | None


class DatasetCoverage(BaseModel):
    region: str
    source: str
    hours: int
    start: datetime | None
    end: datetime | None


class DatasetResponse(BaseModel):
    total_hours: int
    coverage: list[DatasetCoverage]


class TimelinePoint(BaseModel):
    time: datetime
    kind: str
    rain_mm: float
    heavy_rain_probability: float
    expected_rain_next_mm: float
    risk: int


class PredictionResponse(BaseModel):
    region: str
    as_of: datetime
    model_version: str | None
    horizon_hours: int | None
    heavy_rain_mm: float | None
    heavy_rain_probability: float
    heavy_rain_alert: bool
    decision_threshold: float
    expected_rain_next_mm: float
    observed: dict
    risk: int
    timeline: list[TimelinePoint]


@router.get("/status", response_model=MLStatusResponse)
async def ml_status(ml: MLPredictionService = Depends(get_ml_prediction_service)) -> MLStatusResponse:
    """Estado do modelo: versão, período de dados, métricas vs. baselines e importância das features."""
    return MLStatusResponse(**ml.status())


@router.get("/runs")
async def ml_runs(
    limit: int = Query(default=10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> dict:
    """Histórico auditável das execuções de treino."""
    return {"runs": await ml.recent_runs(db, limit=limit)}


@router.get("/dataset", response_model=DatasetResponse)
async def ml_dataset(
    db: AsyncSession = Depends(get_db),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> DatasetResponse:
    """Cobertura da série horária real armazenada (por região e fonte)."""
    coverage = await ml.observations.coverage(db)
    return DatasetResponse(
        total_hours=sum(c["hours"] for c in coverage),
        coverage=[DatasetCoverage(**c) for c in coverage],
    )


@router.post("/ingest")
async def ml_ingest(
    years: int = Query(default=3, ge=1, le=10, description="Anos de histórico ERA5 a garantir no banco"),
    db: AsyncSession = Depends(get_db),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> dict:
    """Baixa (incrementalmente) o histórico horário real da Open-Meteo Archive e as horas recentes."""
    try:
        return await ml.ingest_history(db, years=years)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.post("/train", response_model=TrainResponse, status_code=202)
async def train_model(
    years: int = Query(default=3, ge=1, le=10, description="Anos de histórico para treino"),
    ingest: bool = Query(default=True, description="Coletar dados novos antes de treinar"),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> TrainResponse:
    """Dispara coleta + treino em background. Acompanhe em GET /ml/status e GET /ml/runs."""
    if ml.training_running:
        raise HTTPException(status_code=409, detail="Treino já em execução. Aguarde a conclusão.")

    async def _run() -> None:
        try:
            await ml.train(years=years, ingest=ingest, trigger="api")
        except Exception as exc:
            print(f"[ML] Erro durante treino: {exc}")

    task = asyncio.create_task(_run())
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return TrainResponse(message=f"Treino iniciado em background com {years} ano(s) de histórico real.")


@router.post("/train/sync", response_model=TrainResponse)
async def train_model_sync(
    years: int = Query(default=3, ge=1, le=10),
    ingest: bool = Query(default=True),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> TrainResponse:
    """Coleta + treino aguardando a conclusão (pode levar alguns minutos)."""
    if ml.training_running:
        raise HTTPException(status_code=409, detail="Treino já em execução.")
    try:
        metadata = await ml.train(years=years, ingest=ingest, trigger="api")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha no treino: {exc}") from exc
    return TrainResponse(message="Treino concluído.", metadata=metadata)


@router.get("/predict/{region_id}", response_model=PredictionResponse)
async def predict_region(
    region_id: str,
    db: AsyncSession = Depends(get_db),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> PredictionResponse:
    """Nowcast: probabilidade de chuva forte nas próximas horas, chuva esperada e risco 0–100."""
    if not ml.model_available:
        raise HTTPException(status_code=503, detail="Modelo ainda não treinado. Use POST /api/v1/ml/train.")
    prediction = await ml.predict_region(db, region_id)
    if prediction is None:
        raise HTTPException(
            status_code=404,
            detail=f"Sem observações horárias recentes para {region_id.upper()}. Aguarde a sincronização.",
        )
    return PredictionResponse(**prediction)
