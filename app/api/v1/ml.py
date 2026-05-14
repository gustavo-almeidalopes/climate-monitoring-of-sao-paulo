from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import get_ml_prediction_service
from app.services.ml_prediction_service import MLPredictionService

router = APIRouter(prefix="/ml", tags=["Machine Learning"])

_training_running = False


class TrainRequest(BaseModel):
    years: int = 2


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
async def ml_status(
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> MLStatusResponse:
    """Retorna o estado atual do modelo ML: disponibilidade, métricas e importância das features."""
    return MLStatusResponse(**ml.status())


@router.post("/train", response_model=TrainResponse)
async def train_model(
    background_tasks: BackgroundTasks,
    years: int = Query(default=2, ge=1, le=5, description="Anos de histórico para treino"),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> TrainResponse:
    """Dispara coleta de dados históricos e treino do modelo ML em background.

    - Fonte primária: Open-Meteo Archive (gratuita, sem chave)
    - Fonte complementar: INMET estação A701 (São Paulo/Mirante d'Oeste)
    - Labels: limiares CEMADEN/Defesa Civil SP (rain_24h > 50 mm, etc.)
    - Algoritmo: GradientBoostingClassifier (scikit-learn)

    O treino pode levar alguns minutos dependendo da quantidade de anos solicitada.
    Consulte /ml/status para acompanhar o resultado após o término.
    """
    global _training_running
    if _training_running:
        raise HTTPException(status_code=409, detail="Treino já em execução. Aguarde a conclusão.")

    async def _run_training() -> None:
        global _training_running
        _training_running = True
        try:
            await ml.train(years=years)
        except Exception as exc:
            print(f"[ML] Erro durante treino: {exc}")
        finally:
            _training_running = False

    background_tasks.add_task(_run_training)

    return TrainResponse(
        message=f"Treino iniciado em background com {years} ano(s) de histórico. "
                "Consulte GET /api/v1/ml/status para o resultado."
    )


@router.post("/train/sync", response_model=TrainResponse)
async def train_model_sync(
    years: int = Query(default=2, ge=1, le=5, description="Anos de histórico para treino"),
    ml: MLPredictionService = Depends(get_ml_prediction_service),
) -> TrainResponse:
    """Treina o modelo de forma síncrona (aguarda a conclusão).

    Use para scripts ou ambientes onde o resultado imediato é necessário.
    Pode demorar vários minutos para 2+ anos de dados.
    """
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

    return TrainResponse(
        message="Treino concluído com sucesso.",
        metrics=metrics,
    )
