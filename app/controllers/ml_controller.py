from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_ml_prediction_service
from app.services.ml_prediction_service import MLPredictionService

router = APIRouter(prefix="/ml", tags=["Machine Learning"])

_training_running = False


class TrainResponse(BaseModel):
    message: str
    metrics: dict | None = None


class MLStatusResponse(BaseModel):
    model_available: bool
    model_path: str
    model_file_exists: bool
    feature_importance: dict[str, float]
    train_metrics: dict


@router.get("/status", response_model=MLStatusResponse)
async def ml_status(ml: MLPredictionService = Depends(get_ml_prediction_service)) -> MLStatusResponse:
    return MLStatusResponse(**ml.status())


@router.post("/train", response_model=TrainResponse)
async def train_model(
    background_tasks: BackgroundTasks,
    years: int = Query(default=2, ge=1, le=5),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> TrainResponse:
    global _training_running
    if _training_running:
        raise HTTPException(status_code=409, detail="Treino já em execução. Aguarde.")

    async def _run() -> None:
        global _training_running
        _training_running = True
        try:
            await ml.train(years=years)
        except Exception as exc:
            print(f"[ML] Erro no treino: {exc}")
        finally:
            _training_running = False

    background_tasks.add_task(_run)
    return TrainResponse(message=f"Treino iniciado em background com {years} ano(s). Consulte GET /api/v1/ml/status.")


@router.post("/train/sync", response_model=TrainResponse)
async def train_model_sync(
    years: int = Query(default=2, ge=1, le=5),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> TrainResponse:
    global _training_running
    if _training_running:
        raise HTTPException(status_code=409, detail="Treino já em execução.")
    _training_running = True
    try:
        metrics = await ml.train(years=years)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha no treino: {exc}") from exc
    finally:
        _training_running = False
    return TrainResponse(message="Treino concluído.", metrics=metrics)
