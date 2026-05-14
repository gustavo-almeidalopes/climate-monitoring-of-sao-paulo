from fastapi import APIRouter

from app.controllers.health_controller import router as health_router
from app.controllers.ml_controller import router as ml_router
from app.controllers.news_controller import router as news_router
from app.controllers.weather_controller import router as weather_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(weather_router)
api_router.include_router(ml_router)
api_router.include_router(news_router)
