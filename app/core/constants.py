from __future__ import annotations

from typing import TypedDict


class RegionSeed(TypedDict):
    code: str
    name: str
    short_name: str
    color: str
    latitude: float
    longitude: float


REGION_SEEDS: tuple[RegionSeed, ...] = (
    {
        "code": "CV",
        "name": "Subprefeitura Casa Verde/Cachoeirinha",
        "short_name": "Casa Verde",
        "color": "#22c55e",
        "latitude": -23.490,
        "longitude": -46.660,
    },
    {
        "code": "ST",
        "name": "Subprefeitura Santana/Tucuruvi",
        "short_name": "Santana",
        "color": "#3b82f6",
        "latitude": -23.485,
        "longitude": -46.615,
    },
    {
        "code": "JT",
        "name": "Subprefeitura Jacana/Tremembe",
        "short_name": "Jacana",
        "color": "#a855f7",
        "latitude": -23.445,
        "longitude": -46.585,
    },
    {
        "code": "MG",
        "name": "Subprefeitura Vila Maria/Guilherme",
        "short_name": "Vila Maria",
        "color": "#f97316",
        "latitude": -23.510,
        "longitude": -46.585,
    },
)
