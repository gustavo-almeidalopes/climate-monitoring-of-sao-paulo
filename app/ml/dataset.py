from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import TYPE_CHECKING

import httpx

if TYPE_CHECKING:
    import pandas as pd

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Estações INMET mais próximas das regiões monitoradas (norte de SP)
INMET_STATION_SP = "A701"  # São Paulo / Mirante d'Oeste — -23.50, -46.62

SP_REGIONS = [
    {"code": "CV", "latitude": -23.490, "longitude": -46.660},
    {"code": "ST", "latitude": -23.485, "longitude": -46.615},
    {"code": "JT", "latitude": -23.445, "longitude": -46.585},
    {"code": "MG", "latitude": -23.510, "longitude": -46.585},
]


async def fetch_open_meteo_historical(
    latitude: float,
    longitude: float,
    start_date: date,
    end_date: date,
) -> "pd.DataFrame":
    """Busca dados históricos horários na API Open-Meteo Archive (gratuita, sem chave)."""
    import pandas as pd

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "hourly": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
        "timezone": "America/Sao_Paulo",
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.get(OPEN_METEO_ARCHIVE_URL, params=params)
        resp.raise_for_status()
        data = resp.json()

    hourly = data.get("hourly", {})
    if not hourly.get("time"):
        return pd.DataFrame()

    return pd.DataFrame(
        {
            "recorded_at": pd.to_datetime(hourly["time"]),
            "temperature_c": hourly.get("temperature_2m", []),
            "humidity_percent": hourly.get("relative_humidity_2m", []),
            "rain_mm": hourly.get("precipitation", []),
            "wind_kmh": hourly.get("wind_speed_10m", []),
        }
    ).dropna(subset=["rain_mm"])


async def fetch_inmet_historical(
    station_code: str,
    start_date: date,
    end_date: date,
) -> "pd.DataFrame":
    """Busca dados históricos horários da API INMET (Instituto Nacional de Meteorologia).

    Retorna DataFrame vazio se a API estiver indisponível — o treino usa Open-Meteo como fallback.
    """
    import pandas as pd

    url = f"https://apitempo.inmet.gov.br/estacao/{start_date}/{end_date}/{station_code}"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            records = resp.json()
    except Exception as exc:
        print(f"  [INMET] Indisponível para estação {station_code}: {exc}")
        return pd.DataFrame()

    if not records:
        return pd.DataFrame()

    rows = []
    for rec in records:
        try:
            dt_str = f"{rec['DT_MEDICAO']} {rec['HR_MEDICAO'][:2]}:00"
            rows.append(
                {
                    "recorded_at": pd.to_datetime(dt_str),
                    "temperature_c": float(rec.get("TEM_INS") or "nan"),
                    "humidity_percent": float(rec.get("UMD_INS") or "nan"),
                    "rain_mm": float(rec.get("CHUVA") or 0.0),
                    "wind_kmh": float(rec.get("VEN_VEL") or 0.0),
                    "source": "inmet",
                }
            )
        except (KeyError, ValueError):
            continue

    df = pd.DataFrame(rows)
    return df.dropna(subset=["temperature_c", "humidity_percent"])


async def collect_training_data(years: int = 2) -> "pd.DataFrame":
    """Coleta dados históricos de todas as regiões de SP para treino do modelo ML.

    Fonte primária: Open-Meteo Archive (gratuita, sem chave)
    Fonte complementar: INMET A701 (São Paulo/Mirante)
    """
    import pandas as pd

    end_date = date.today() - timedelta(days=6)  # archive tem delay ~5 dias
    start_date = end_date - timedelta(days=365 * years)

    print(f"Coletando dados de {start_date} a {end_date} ({years} anos)")

    tasks = [
        fetch_open_meteo_historical(r["latitude"], r["longitude"], start_date, end_date)
        for r in SP_REGIONS
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    dfs: list[pd.DataFrame] = []
    for region, result in zip(SP_REGIONS, results):
        if isinstance(result, Exception):
            print(f"  [Open-Meteo] Falha em {region['code']}: {result}")
            continue
        if result.empty:
            print(f"  [Open-Meteo] Sem dados para {region['code']}")
            continue
        result["region_code"] = region["code"]
        result["source"] = "open-meteo-archive"
        dfs.append(result)
        print(f"  [Open-Meteo] {region['code']}: {len(result):,} registros")

    # Dados INMET como fonte adicional (estação A701 representa o norte de SP)
    print("Coletando INMET A701 (complementar)...")
    inmet_df = await fetch_inmet_historical(INMET_STATION_SP, start_date, end_date)
    if not inmet_df.empty:
        inmet_df["region_code"] = "SP_INMET"
        dfs.append(inmet_df)
        print(f"  [INMET] A701: {len(inmet_df):,} registros")

    if not dfs:
        raise RuntimeError("Nenhum dado histórico coletado. Verifique a conexão.")

    combined = pd.concat(dfs, ignore_index=True)
    print(f"\nTotal combinado: {len(combined):,} registros")
    return combined
