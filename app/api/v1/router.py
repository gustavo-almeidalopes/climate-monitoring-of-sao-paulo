from fastapi import APIRouter

from app.controllers.ml_controller import router as ml_router
from app.api.v1.weather import router as weather_router

api_router = APIRouter()
api_router.include_router(weather_router)
api_router.include_router(ml_router)
