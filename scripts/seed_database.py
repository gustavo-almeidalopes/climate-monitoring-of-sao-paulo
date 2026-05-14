#!/usr/bin/env python
"""
Inicializa e popula o banco de dados do ClimaSP com dados base.

Gera:
  - 4 regiões de São Paulo (já definidas em constants.py)
  - 30 dias × 24h de leituras horárias sintéticas por região (2.880 linhas)
  - ~10 artigos de notícia de exemplo sobre alagamentos em SP

Os dados refletem o clima real de São Paulo para o período de transição
outono/inverno (mai–jun), com chuvas ocasionais e temperaturas moderadas.

Uso:
    cd /home/SEU_USUARIO/climate-monitoring-of-sao-paulo-main
    python scripts/seed_database.py [--days 30] [--db-url sqlite+aiosqlite:///./climasp.db]
"""

from __future__ import annotations

import argparse
import asyncio
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


# ── Geração de clima sintético realista para SP ───────────────────────────────

# Perfil climático mensal de São Paulo (temperatura média e chuva mensal em mm)
# Baseado em dados históricos do INMET / CEMADEN
_MONTHLY_CLIMATE = {
    1:  {"temp_avg": 25.5, "temp_amp": 7.0, "rain_monthly_mm": 220, "humid_base": 82},
    2:  {"temp_avg": 25.8, "temp_amp": 7.0, "rain_monthly_mm": 200, "humid_base": 82},
    3:  {"temp_avg": 25.3, "temp_amp": 7.0, "rain_monthly_mm": 175, "humid_base": 81},
    4:  {"temp_avg": 23.5, "temp_amp": 8.0, "rain_monthly_mm": 90,  "humid_base": 78},
    5:  {"temp_avg": 21.5, "temp_amp": 9.0, "rain_monthly_mm": 70,  "humid_base": 75},
    6:  {"temp_avg": 19.8, "temp_amp": 9.0, "rain_monthly_mm": 55,  "humid_base": 73},
    7:  {"temp_avg": 19.2, "temp_amp": 9.5, "rain_monthly_mm": 40,  "humid_base": 71},
    8:  {"temp_avg": 20.5, "temp_amp": 10.0,"rain_monthly_mm": 40,  "humid_base": 70},
    9:  {"temp_avg": 22.0, "temp_amp": 9.0, "rain_monthly_mm": 85,  "humid_base": 74},
    10: {"temp_avg": 23.5, "temp_amp": 8.0, "rain_monthly_mm": 125, "humid_base": 77},
    11: {"temp_avg": 24.5, "temp_amp": 7.0, "rain_monthly_mm": 145, "humid_base": 80},
    12: {"temp_avg": 25.2, "temp_amp": 7.0, "rain_monthly_mm": 195, "humid_base": 82},
}

# Pequenas variações por região (simula diferenças microclimáticas)
_REGION_OFFSET = {
    "CV": {"temp": +0.3, "rain": +1.05, "humid": +2},   # Casa Verde — mais urbano
    "ST": {"temp": +0.1, "rain": +1.00, "humid": +0},   # Santana — referência
    "JT": {"temp": -0.4, "rain": +0.90, "humid": -2},   # Jacana — mais verde, mais fresco
    "MG": {"temp": +0.5, "rain": +1.10, "humid": +1},   # Vila Maria — mais denso
}

random.seed(42)  # Reprodutibilidade


def _hourly_temp(base: float, amplitude: float, hour: int) -> float:
    """Temperatura horária: mínima às 6h, máxima às 14h."""
    phase = math.cos(math.pi * (hour - 14) / 12)
    return round(base + (amplitude / 2) * phase + random.gauss(0, 0.5), 1)


def _rain_event(monthly_mm: float, hour: int) -> float:
    """Gera chuva horária: concentrada na tarde (12–20h) com picos ocasionais."""
    hours_in_month = 30 * 24
    base_rate = monthly_mm / hours_in_month

    # Probabilidade de chuva: maior entre 14–19h (convectiva)
    if 14 <= hour <= 19:
        prob = base_rate / 5 + 0.08
    elif 20 <= hour <= 23 or 0 <= hour <= 2:
        prob = base_rate / 10 + 0.04
    else:
        prob = base_rate / 20 + 0.01

    if random.random() < min(prob, 0.60):
        # Intensidade: maioria fraca (< 5mm), picos ocasionais (> 20mm)
        r = random.choices(
            [0.0, random.uniform(0.5, 4.0), random.uniform(5.0, 19.0), random.uniform(20.0, 45.0)],
            weights=[0.35, 0.45, 0.15, 0.05],
        )[0]
        return round(r, 2)
    return 0.0


def _humidity(temp: float, rain: float, base: int) -> int:
    humidity = base - (temp - 22) * 1.5 + rain * 1.8 + random.gauss(0, 2)
    return max(40, min(100, int(round(humidity))))


def _wind(rain: float) -> float:
    base = random.uniform(3, 18)
    gust = rain * 0.4 if rain > 5 else 0
    return round(base + gust, 1)


def _risk_heuristic(rain_mm: float, hum: int, wind_kmh: float, temp_c: float) -> int:
    rain_c  = min(rain_mm * 4.2, 48.0)
    hum_c   = min(max(hum - 60, 0) * 1.1, 22.0)
    wind_c  = min(wind_kmh * 0.7, 16.0)
    if temp_c <= 18:   thermal = 6.0
    elif temp_c <= 28: thermal = 10.0
    elif temp_c <= 33: thermal = 7.0
    else:              thermal = 4.0
    return max(0, min(100, int(round(rain_c + hum_c + wind_c + thermal))))


def generate_readings(region_code: str, days: int) -> list[dict]:
    rng = _REGION_OFFSET[region_code]
    now = datetime.now(tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    start = now - timedelta(days=days)

    readings = []
    hour = start
    while hour <= now:
        month   = hour.month
        climate = _MONTHLY_CLIMATE[month]

        temp  = _hourly_temp(climate["temp_avg"] + rng["temp"], climate["temp_amp"], hour.hour)
        rain  = _rain_event(climate["rain_monthly_mm"] * rng["rain"], hour.hour)
        hum   = _humidity(temp, rain, climate["humid_base"] + rng["humid"])
        wind  = _wind(rain)
        risk  = _risk_heuristic(rain, hum, wind, temp)

        readings.append({
            "region_code": region_code,
            "temperature_c": temp,
            "humidity_percent": hum,
            "rain_mm": rain,
            "wind_kmh": wind,
            "flood_risk_index": risk,
            "source": "seed-synthetic",
            "recorded_at": hour,
        })
        hour += timedelta(hours=1)

    return readings


# ── Artigos de notícia de exemplo ─────────────────────────────────────────────
SAMPLE_NEWS = [
    {
        "title": "Chuva intensa provoca alagamentos na zona norte de São Paulo",
        "summary": "Defesa Civil registrou ocorrências em Casa Verde e Santana após chuva de 45mm em menos de 2 horas. Equipes foram acionadas para remover veículos ilhados.",
        "url": "https://g1.globo.com/sp/sao-paulo/noticia/exemplo-alagamento-zona-norte",
        "source": "G1 São Paulo",
        "relevance_score": 8.5,
        "matched_keywords": "alagamento,chuva intensa,defesa civil",
    },
    {
        "title": "Sirenes da Defesa Civil são acionadas em Jacana após nível do córrego subir",
        "summary": "O Córrego do Carandiru ultrapassou a cota de atenção após precipitação acumulada de 60mm em 24h. Moradores foram alertados a deixar as margens.",
        "url": "https://g1.globo.com/sp/sao-paulo/noticia/exemplo-sirenes-jacana",
        "source": "G1 São Paulo",
        "relevance_score": 9.0,
        "matched_keywords": "alagamento,enchente,sirene,defesa civil",
    },
    {
        "title": "CEMADEN emite alerta de chuva forte para o município de São Paulo",
        "summary": "O Centro Nacional de Monitoramento e Alertas de Desastres Naturais prevê precipitação acumulada entre 50 e 80mm nas próximas 24 horas na Grande SP.",
        "url": "https://g1.globo.com/sp/sao-paulo/noticia/exemplo-alerta-cemaden",
        "source": "G1 São Paulo",
        "relevance_score": 7.5,
        "matched_keywords": "alerta de chuva,chuva forte,CEMADEN",
    },
    {
        "title": "Temporal derruba árvores e causa transbordamento de córregos na capital",
        "summary": "Temporal com raios e vento de até 80km/h atingiu São Paulo na tarde desta terça-feira. Vila Maria e Santana registraram os maiores acúmulos de chuva.",
        "url": "https://folha.uol.com.br/cotidiano/exemplo-temporal-sp",
        "source": "Folha de SP - Cotidiano",
        "relevance_score": 8.0,
        "matched_keywords": "temporal,transbordamento,chuva forte",
    },
    {
        "title": "Prefeitura ativa Plano de Contingência para chuvas de verão",
        "summary": "A Defesa Civil Municipal informou que 12 equipes de campo estão de prontidão nas regiões de maior vulnerabilidade a alagamentos na zona norte.",
        "url": "https://folha.uol.com.br/cotidiano/exemplo-plano-contingencia",
        "source": "Folha de SP - Cotidiano",
        "relevance_score": 6.5,
        "matched_keywords": "defesa civil,alagamento,emergência climática",
    },
    {
        "title": "Ruas alagadas interrompem trânsito em Cachoeirinha e Vila Guilherme",
        "summary": "Motoristas relataram lâminas d'água de até 40cm em pontos críticos. CET recomendou rotas alternativas. Bombeiros foram acionados para resgates.",
        "url": "https://g1.globo.com/sp/sao-paulo/noticia/exemplo-ruas-alagadas",
        "source": "G1 São Paulo",
        "relevance_score": 7.0,
        "matched_keywords": "alagadas,ruas alagadas,alagamento",
    },
    {
        "title": "Inundação atinge viaduto na marginal do Rio Tietê",
        "summary": "A Marginal Tietê foi parcialmente fechada após inundação registrada próximo à Ponte do Piqueri. Nível do rio atingiu cota de atenção.",
        "url": "https://uol.com.br/noticias/exemplo-marginal-tietê",
        "source": "UOL Notícias",
        "relevance_score": 8.0,
        "matched_keywords": "inundação,enchente,rio overflowed",
    },
    {
        "title": "São Paulo registra 3ª semana consecutiva com chuvas acima da média",
        "summary": "Segundo o CGE, o acumulado de chuva no mês já supera 150% da média histórica. Especialistas alertam para risco de alagamentos continuados.",
        "url": "https://g1.globo.com/sp/sao-paulo/noticia/exemplo-chuvas-acima-media",
        "source": "G1 São Paulo",
        "relevance_score": 6.0,
        "matched_keywords": "chuva,precipitação,clima",
    },
    {
        "title": "Deslizamento de terra interdita rua em Tucuruvi após chuva de 70mm",
        "summary": "Um talude desabou sobre a Rua Tucuruvi às 22h. Bombeiros isolaram a área e não há vítimas. Acúmulo de 70mm foi registrado nas últimas 6 horas.",
        "url": "https://folha.uol.com.br/cotidiano/exemplo-deslizamento-tucuruvi",
        "source": "Folha de SP - Cotidiano",
        "relevance_score": 8.5,
        "matched_keywords": "deslizamento,alagamento,chuva intensa",
    },
    {
        "title": "Previsão: semana terá chuva moderada e temperaturas entre 18°C e 27°C",
        "summary": "Segundo o INMET, uma frente fria avança pelo litoral paulista trazendo precipitação entre 20 e 40mm ao longo dos próximos 5 dias.",
        "url": "https://g1.globo.com/sp/sao-paulo/noticia/exemplo-previsao-semana",
        "source": "G1 São Paulo",
        "relevance_score": 3.5,
        "matched_keywords": "chuva,precipitação,meteorologia",
    },
]


# ── Runner assíncrono ─────────────────────────────────────────────────────────
async def seed(days: int, db_url: str) -> None:
    import os
    os.environ.setdefault("DATABASE_URL", db_url)

    from app.db.init_db import init_db
    from app.db.session import AsyncSessionLocal
    from app.models.news_article import NewsArticle
    from app.models.region import Region
    from app.models.weather_reading import WeatherReading
    from app.core.constants import REGION_SEEDS
    from sqlalchemy import select

    print("=" * 60)
    print("  ClimaSP — Seed do banco de dados")
    print("=" * 60)
    print(f"\nBanco: {db_url}")
    print(f"Dias de histórico: {days}")

    # Cria todas as tabelas
    print("\n[1/4] Criando tabelas…")
    await init_db()

    async with AsyncSessionLocal() as session:
        # ── Regiões ──────────────────────────────────────────────────────────
        print("[2/4] Inserindo regiões…")
        existing = set((await session.scalars(select(Region.code))).all())
        added_regions = 0
        for seed_data in REGION_SEEDS:
            if seed_data["code"] in existing:
                print(f"  Região {seed_data['code']} já existe — pulando.")
                continue
            session.add(Region(**seed_data))
            added_regions += 1
        await session.commit()
        print(f"  {added_regions} região(ões) inserida(s).")

        # ── Leituras históricas sintéticas ────────────────────────────────────
        print(f"[3/4] Gerando {days} dias de leituras horárias sintéticas…")
        region_codes = [s["code"] for s in REGION_SEEDS]
        total_inserted = 0

        for code in region_codes:
            readings = generate_readings(code, days)
            for r in readings:
                session.add(WeatherReading(**r))
            total_inserted += len(readings)
            print(f"  {code}: {len(readings):,} leituras geradas.")

        await session.commit()
        print(f"  Total: {total_inserted:,} leituras inseridas.")

        # ── Artigos de notícia de exemplo ─────────────────────────────────────
        print("[4/4] Inserindo artigos de notícia de exemplo…")
        from sqlalchemy import select as sel
        existing_urls = set(
            (await session.scalars(sel(NewsArticle.url))).all()
        )
        now = datetime.now(tz=timezone.utc)
        news_inserted = 0

        for i, article_data in enumerate(SAMPLE_NEWS):
            if article_data["url"] in existing_urls:
                continue
            # Distribui os artigos nos últimos 7 dias retroativamente
            pub_offset = timedelta(hours=i * 17 + random.randint(1, 12))
            session.add(
                NewsArticle(
                    title=article_data["title"],
                    summary=article_data["summary"],
                    url=article_data["url"],
                    source=article_data["source"],
                    published_at=now - pub_offset,
                    scraped_at=now - pub_offset + timedelta(minutes=random.randint(5, 30)),
                    relevance_score=article_data["relevance_score"],
                    matched_keywords=article_data["matched_keywords"],
                )
            )
            news_inserted += 1

        await session.commit()
        print(f"  {news_inserted} artigo(s) inserido(s).")

    print("\n✓ Seed concluído com sucesso!")
    print(f"  Banco pronto em: {db_url.replace('sqlite+aiosqlite:///', '')}")
    print("\nPróximos passos:")
    print("  1. Inicie o servidor: uvicorn app.main:app --host 0.0.0.0 --port 8000")
    print("  2. Acesse o painel: http://localhost:8000/")
    print("  3. (Opcional) Treine o modelo ML: python scripts/collect_and_train.py")


def main() -> None:
    parser = argparse.ArgumentParser(description="Popula o banco de dados inicial do ClimaSP.")
    parser.add_argument("--days", type=int, default=30, help="Dias de histórico a gerar (padrão: 30)")
    parser.add_argument(
        "--db-url",
        type=str,
        default="sqlite+aiosqlite:///./climasp.db",
        help="URL do banco de dados SQLite",
    )
    args = parser.parse_args()
    asyncio.run(seed(days=args.days, db_url=args.db_url))


if __name__ == "__main__":
    main()
