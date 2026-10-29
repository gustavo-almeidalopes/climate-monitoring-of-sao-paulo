from __future__ import annotations

from app.core.rain_thresholds import RED_MM_H


def combine_flood_risk(
    *,
    heavy_rain_probability: float,
    rain_1h: float,
    rain_3h: float,
    rain_24h: float,
) -> int:
    """Índice 0–100 que une "já está chovendo forte" com "vai chover forte".

    - componente observado: chuva real já acumulada, normalizada pelos níveis de alerta
      (40 mm/h = nível vermelho CEMADEN; 60 mm/3h e 100 mm/24h saturam drenagem e solo);
    - componente previsto: probabilidade do modelo de chuva forte nas próximas horas.

    risco = 1 - (1 - observado) * (1 - previsto)  → nunca menor que nenhum dos dois.
    """
    observed = max(
        max(rain_1h, 0.0) / RED_MM_H,
        max(rain_3h, 0.0) / 60.0,
        max(rain_24h, 0.0) / 100.0,
    )
    observed = min(1.0, observed)
    predicted = min(1.0, max(0.0, heavy_rain_probability))
    return int(round(100.0 * (1.0 - (1.0 - observed) * (1.0 - predicted))))
