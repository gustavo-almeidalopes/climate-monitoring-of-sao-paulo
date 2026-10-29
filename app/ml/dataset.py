"""Coleta de séries horárias REAIS para treino e inferência.

Fontes (gratuitas, sem chave):
  - Open-Meteo Historical/Archive API (reanálise ERA5 / ERA5-Land, disponível com ~5 dias de atraso)
    https://open-meteo.com/en/docs/historical-weather-api
  - Open-Meteo Forecast API com `past_days` — cobre os últimos dias (análise do modelo) e as
    próximas horas (previsão), com exatamente as mesmas variáveis usadas no treino.

Todas as datas são tratadas em UTC (`timeformat=unixtime`), evitando ambiguidades de fuso.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from app.core.config import get_settings

# Variáveis presentes tanto na Archive API quanto na Forecast API (mesmo nome e unidade),
# para que treino (histórico) e inferência (tempo real) usem features idênticas.
HOURLY_VARIABLES: dict[str, str] = {
    "temperature_2m": "temperature_c",
    "relative_humidity_2m": "humidity_percent",
    "dew_point_2m": "dew_point_c",
    "precipitation": "precipitation_mm",
    "pressure_msl": "pressure_hpa",
    "cloud_cover": "cloud_cover_percent",
    "wind_speed_10m": "wind_kmh",
    "wind_direction_10m": "wind_direction_deg",
    "wind_gusts_10m": "wind_gust_kmh",
}

OBSERVATION_COLUMNS: list[str] = list(HOURLY_VARIABLES.values())

ARCHIVE_DELAY_DAYS = 5
FORECAST_MAX_PAST_DAYS = 92


@dataclass(slots=True)
class HourlyRecord:
    region_code: str
    observed_at: datetime
    values: dict[str, float | None]
    source: str


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def parse_hourly_payload(payload: dict, region_code: str, source: str) -> list[HourlyRecord]:
    """Converte o bloco `hourly` da Open-Meteo em registros normalizados (UTC)."""
    hourly = payload.get("hourly") or {}
    times = hourly.get("time") or []
    records: list[HourlyRecord] = []
    for idx, ts in enumerate(times):
        try:
            observed_at = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        except (TypeError, ValueError, OSError):
            continue
        values: dict[str, float | None] = {}
        for api_name, column in HOURLY_VARIABLES.items():
            series = hourly.get(api_name) or []
            values[column] = _num(series[idx]) if idx < len(series) else None
        # Sem precipitação a hora não serve nem como feature nem como alvo.
        if values.get("precipitation_mm") is None:
            continue
        records.append(HourlyRecord(region_code, observed_at, values, source))
    return records


def _year_chunks(start: date, end: date) -> list[tuple[date, date]]:
    chunks: list[tuple[date, date]] = []
    cursor = start
    while cursor <= end:
        chunk_end = min(end, date(cursor.year, 12, 31))
        chunks.append((cursor, chunk_end))
        cursor = chunk_end + timedelta(days=1)
    return chunks


async def _get_json(client: httpx.AsyncClient, url: str, params: dict, attempts: int = 3) -> dict:
    last_exc: Exception | None = None
    for attempt in range(attempts):
        try:
            resp = await client.get(url, params=params)
            if resp.status_code == 429 or resp.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"HTTP {resp.status_code}", request=resp.request, response=resp
                )
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            last_exc = exc
            if attempt < attempts - 1:
                await asyncio.sleep(1.5 * (2**attempt))
    raise RuntimeError(f"Falha ao consultar {url}: {last_exc}") from last_exc


async def fetch_archive(
    client: httpx.AsyncClient,
    *,
    region_code: str,
    latitude: float,
    longitude: float,
    start_date: date,
    end_date: date,
) -> list[HourlyRecord]:
    """Baixa a série horária histórica (ERA5) de uma coordenada, em blocos anuais."""
    settings = get_settings()
    records: list[HourlyRecord] = []
    for chunk_start, chunk_end in _year_chunks(start_date, end_date):
        payload = await _get_json(
            client,
            settings.open_meteo_archive_url,
            {
                "latitude": latitude,
                "longitude": longitude,
                "start_date": chunk_start.isoformat(),
                "end_date": chunk_end.isoformat(),
                "hourly": ",".join(HOURLY_VARIABLES),
                "timezone": "GMT",
                "timeformat": "unixtime",
            },
        )
        records.extend(parse_hourly_payload(payload, region_code, "open-meteo-archive"))
    return records


async def fetch_recent_and_forecast(
    client: httpx.AsyncClient,
    *,
    region_code: str,
    latitude: float,
    longitude: float,
    past_days: int = 3,
    forecast_days: int = 2,
    now: datetime | None = None,
) -> tuple[list[HourlyRecord], list[HourlyRecord]]:
    """Retorna (horas já ocorridas, próximas horas) da Forecast API com as variáveis do treino."""
    settings = get_settings()
    payload = await _get_json(
        client,
        settings.open_meteo_url,
        {
            "latitude": latitude,
            "longitude": longitude,
            "hourly": ",".join(HOURLY_VARIABLES),
            "past_days": max(0, min(FORECAST_MAX_PAST_DAYS, past_days)),
            "forecast_days": max(1, min(7, forecast_days)),
            "timezone": "GMT",
            "timeformat": "unixtime",
        },
    )
    records = parse_hourly_payload(payload, region_code, "open-meteo-analysis")
    anchor = (now or datetime.now(tz=timezone.utc)).replace(minute=0, second=0, microsecond=0)
    past = [r for r in records if r.observed_at <= anchor]
    future = [
        HourlyRecord(r.region_code, r.observed_at, r.values, "open-meteo-forecast")
        for r in records
        if r.observed_at > anchor
    ]
    return past, future


def archive_window(years: int, *, today: date | None = None) -> tuple[date, date]:
    end = (today or date.today()) - timedelta(days=ARCHIVE_DELAY_DAYS)
    start = end - timedelta(days=int(365.25 * max(1, years)))
    return start, end


def new_http_client() -> httpx.AsyncClient:
    settings = get_settings()
    return httpx.AsyncClient(
        timeout=settings.ml_archive_timeout_seconds,
        headers={"User-Agent": "ClimaSP/1.0 (monitoramento climatico SP)"},
    )
