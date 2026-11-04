"""Critério único de nível de perigo (Baixo/Médio/Alto/Crítico).

O nível é o PIOR entre:
  (a) a chuva observada na última hora contra os limiares CEMADEN/Defesa Civil
      (5 / 20 / 40 mm/h — app/core/rain_thresholds.py);
  (b) o índice de risco 0–100 contra os cortes RISK_CUTS — só quando o índice vem do
      modelo (risk_source == "ml"), que combina chuva acumulada (1 h/3 h/24 h) com a
      probabilidade de chuva forte prevista. O índice heurístico (fallback sem modelo)
      mistura umidade, vento e temperatura e dá ~35–40 pontos sem chuva; por isso ele
      não sobe o nível.

O front-end (js/risk.js) implementa a mesma regra com os valores servidos em
/api/v1/weather/thresholds — o teste tests/test_risk_levels.py fixa os casos.
"""
from __future__ import annotations

from datetime import datetime

from app.core.rain_thresholds import ORANGE_MM_H, RED_MM_H, YELLOW_MM_H

LEVELS: tuple[str, ...] = ("low", "medium", "high", "critical")
LABELS = {"low": "Baixo", "medium": "Médio", "high": "Alto", "critical": "Crítico"}
# Cortes do índice de risco (0–100). Escolha do projeto, não critério oficial.
RISK_CUTS = {"medium": 25, "high": 50, "critical": 75}


def rank(level: str) -> int:
    return LEVELS.index(level) if level in LEVELS else 0


def level_from_rain(rain_mm: float | None) -> str:
    r = rain_mm or 0.0
    if r >= RED_MM_H:
        return "critical"
    if r >= ORANGE_MM_H:
        return "high"
    if r >= YELLOW_MM_H:
        return "medium"
    return "low"


def level_from_risk(risk: float | None) -> str:
    v = risk or 0
    if v >= RISK_CUTS["critical"]:
        return "critical"
    if v >= RISK_CUTS["high"]:
        return "high"
    if v >= RISK_CUTS["medium"]:
        return "medium"
    return "low"


def unified_level(rain_mm: float | None, risk: float | None, risk_source: str | None) -> dict:
    """{level, label, reason} pelo critério único."""
    by_rain = level_from_rain(rain_mm)
    by_risk = level_from_risk(risk) if risk_source == "ml" else "low"
    if rank(by_risk) > rank(by_rain):
        level, reason = by_risk, "risco combinado: chuva acumulada e previsão do modelo"
    elif by_rain != "low":
        level, reason = by_rain, "chuva observada na última hora"
    else:
        level, reason = "low", "sem chuva significativa"
    return {"level": level, "label": LABELS[level], "reason": reason}


def thresholds_extra() -> dict:
    return {"risk_cuts": dict(RISK_CUTS)}


def trend(points: list[tuple[datetime, float]], *, min_delta: float) -> dict:
    """Tendência recente de uma série (ordem cronológica).

    Volta no tempo enquanto a série continua no mesmo sentido (patamares contam);
    `since` é quando a subida/descida começou. Variação menor que `min_delta` = estável.
    """
    pts = [(t, v) for t, v in points if v is not None]
    if len(pts) < 2:
        return {"direction": "flat", "since": None, "delta": 0.0}
    latest_t, latest_v = pts[-1]

    def run(cmp) -> tuple[datetime, float]:
        start_t, start_v = pts[-1]
        for t, v in reversed(pts[:-1]):
            if v == start_v:
                continue  # patamar: o início fica no ponto mais recente desse valor
            if cmp(v, start_v):
                start_t, start_v = t, v
            else:
                break
        return start_t, start_v

    up_t, up_v = run(lambda older, newer: older <= newer)
    down_t, down_v = run(lambda older, newer: older >= newer)
    if latest_v - up_v >= min_delta:
        return {"direction": "up", "since": up_t, "delta": round(latest_v - up_v, 2)}
    if down_v - latest_v >= min_delta:
        return {"direction": "down", "since": down_t, "delta": round(latest_v - down_v, 2)}
    return {"direction": "flat", "since": None, "delta": round(latest_v - pts[0][1], 2)}
