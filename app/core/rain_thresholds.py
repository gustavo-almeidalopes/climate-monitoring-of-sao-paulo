from __future__ import annotations

# Limiares de chuva baseados nos critérios CEMADEN / Defesa Civil SP (mm/hora)
YELLOW_MM_H: float = 5.0    # Atenção    — início de risco
ORANGE_MM_H: float = 20.0   # Observação — risco moderado
RED_MM_H:    float = 40.0   # Alerta     — risco crítico

# Labels e cores hex correspondentes
_LEVELS = [
    ("red",    RED_MM_H,    "#ef4444", "Crítico"),
    ("orange", ORANGE_MM_H, "#f97316", "Alto"),
    ("yellow", YELLOW_MM_H, "#eab308", "Médio"),
    ("green",  0.0,         "#22c55e", "Baixo"),
]


def get_danger_level(rain_mm: float) -> str:
    for level, threshold, _, _ in _LEVELS:
        if rain_mm >= threshold:
            return level
    return "green"


def get_danger_color(rain_mm: float) -> str:
    for _, threshold, color, _ in _LEVELS:
        if rain_mm >= threshold:
            return color
    return "#22c55e"


def get_danger_label(rain_mm: float) -> str:
    for _, threshold, _, label in _LEVELS:
        if rain_mm >= threshold:
            return label
    return "Baixo"


def thresholds_dict() -> dict:
    return {
        "yellow_mm_h": YELLOW_MM_H,
        "orange_mm_h": ORANGE_MM_H,
        "red_mm_h": RED_MM_H,
        "levels": [
            {"level": lvl, "min_mm_h": thr, "color": col, "label": lbl}
            for lvl, thr, col, lbl in _LEVELS
        ],
    }
