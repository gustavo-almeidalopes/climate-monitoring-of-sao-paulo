from fastapi import APIRouter

from app.api.v1.weather import router as weather_router

api_router = APIRouter()
api_router.include_router(weather_router)
