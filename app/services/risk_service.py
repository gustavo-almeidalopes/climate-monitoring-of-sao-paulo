from __future__ import annotations


def _clamp(value: float, minimum: int = 0, maximum: int = 100) -> int:
    return int(max(minimum, min(maximum, round(value))))


def calculate_flood_risk(
    *,
    rain_mm: float,
    humidity_percent: int,
    wind_kmh: float,
    temperature_c: float,
    aqi: int | None = None,
) -> int:
    """Indice heuristico de alagamento (0-100).

    Pesos escolhidos para um score responsivo em monitoramento operacional:
    - Chuva recente pesa mais.
    - Umidade alta aumenta saturacao do solo.
    - Ventos fortes e variacao termica ajudam a antecipar instabilidade.
    """

    rain_component = min(max(rain_mm, 0.0) * 4.2, 48.0)
    humidity_component = min(max(humidity_percent - 60, 0) * 1.1, 22.0)
    wind_component = min(max(wind_kmh, 0.0) * 0.7, 16.0)

    if temperature_c <= 18:
        thermal_component = 6.0
    elif temperature_c <= 28:
        thermal_component = 10.0
    elif temperature_c <= 33:
        thermal_component = 7.0
    else:
        thermal_component = 4.0

    air_component = 0.0
    if aqi is not None:
        air_component = min(max(aqi - 40, 0) * 0.08, 6.0)

    return _clamp(rain_component + humidity_component + wind_component + thermal_component + air_component)
