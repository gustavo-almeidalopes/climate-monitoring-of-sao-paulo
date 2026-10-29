"""Simulador da Open-Meteo para testes offline (mesmo formato JSON da API real).

Gera uma atmosfera sintética com física simples: a chuva forte é precedida por queda de
pressão, aumento de umidade/nebulosidade e aproximação do ponto de orvalho — sinais que o
modelo precisa aprender a usar para *antecipar* a chuva.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import httpx
import numpy as np

from app.ml.dataset import HOURLY_VARIABLES

EPOCH_START = datetime(2020, 1, 1, tzinfo=timezone.utc)
EPOCH_END = datetime(2027, 1, 1, tzinfo=timezone.utc)


def _simulate(seed: int = 7) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    n = int((EPOCH_END - EPOCH_START).total_seconds() // 3600)
    t = np.arange(n)
    hour_local = (t - 3) % 24
    doy = (t / 24.0) % 365.25
    summer = 0.5 + 0.5 * np.cos(2 * np.pi * (doy - 15) / 365.25)  # chuvoso em jan

    precip = np.zeros(n)
    pressure_anom = np.zeros(n)
    moisture = np.zeros(n)
    i = 0
    while i < n - 12:
        convective_hour = 13 <= hour_local[i] <= 18
        p_event = 0.002 + 0.012 * summer[i] * (1.6 if convective_hour else 0.5)
        if rng.random() < p_event:
            lead = rng.integers(3, 7)
            dur = rng.integers(1, 4)
            intensity = rng.gamma(1.6, 5.0 + 6.0 * summer[i])
            pressure_anom[i : i + lead] -= np.linspace(0.3, 2.5, lead) * (intensity / 10)
            moisture[i : i + lead] += np.linspace(0.2, 1.0, lead)
            precip[i + lead : i + lead + dur] += intensity * rng.uniform(0.5, 1.2, dur)
            moisture[i + lead : i + lead + dur] += 1.0
            i += lead + dur
        else:
            if rng.random() < 0.03:
                precip[i] += rng.exponential(0.3)
            i += 1

    temp = 19 + 5 * summer + 4.5 * np.cos(2 * np.pi * (hour_local - 14) / 24) - 2.0 * np.clip(moisture, 0, 1)
    temp += rng.normal(0, 0.4, n)
    humidity = np.clip(70 - 15 * np.cos(2 * np.pi * (hour_local - 14) / 24) + 22 * np.clip(moisture, 0, 1) + rng.normal(0, 3, n), 20, 100)
    dew = temp - (100 - humidity) / 5.0
    pressure = 1016 - 4 * summer + np.cumsum(rng.normal(0, 0.05, n)) * 0.0 + pressure_anom + rng.normal(0, 0.3, n)
    cloud = np.clip(35 + 55 * np.clip(moisture, 0, 1) + rng.normal(0, 12, n), 0, 100)
    wind = np.clip(8 + 10 * np.clip(moisture, 0, 1) + rng.normal(0, 2.5, n), 0, None)
    gust = wind * 1.7
    direction = (np.where(moisture > 0.3, 200, 110) + rng.normal(0, 25, n)) % 360

    return {
        "time": (EPOCH_START.timestamp() + t * 3600).astype(np.int64),
        "temperature_2m": temp.round(1),
        "relative_humidity_2m": humidity.round(0),
        "dew_point_2m": dew.round(1),
        "precipitation": precip.round(1),
        "pressure_msl": pressure.round(1),
        "cloud_cover": cloud.round(0),
        "wind_speed_10m": wind.round(1),
        "wind_direction_10m": direction.round(0),
        "wind_gusts_10m": gust.round(1),
    }


class FakeOpenMeteo:
    def __init__(self, now: datetime) -> None:
        self.now = now
        self.series = _simulate()
        self.calls: list[tuple[str, dict]] = []

    def _payload(self, start: datetime, end_exclusive: datetime) -> dict:
        times = self.series["time"]
        mask = (times >= int(start.timestamp())) & (times < int(end_exclusive.timestamp()))
        hourly = {"time": times[mask].tolist()}
        for api_name in HOURLY_VARIABLES:
            hourly[api_name] = self.series[api_name][mask].tolist()
        return {"latitude": -23.5, "longitude": -46.6, "hourly": hourly}

    def handler(self, request: httpx.Request) -> httpx.Response:
        params = dict(request.url.params)
        self.calls.append((request.url.host, params))
        if "archive" in request.url.host:
            start = datetime.combine(date.fromisoformat(params["start_date"]), datetime.min.time(), timezone.utc)
            end = datetime.combine(date.fromisoformat(params["end_date"]), datetime.min.time(), timezone.utc) + timedelta(days=1)
            return httpx.Response(200, json=self._payload(start, end))
        today = self.now.replace(hour=0, minute=0, second=0, microsecond=0)
        start = today - timedelta(days=int(params.get("past_days", 0)))
        end = today + timedelta(days=int(params.get("forecast_days", 1)))
        return httpx.Response(200, json=self._payload(start, end))

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.MockTransport(self.handler))
