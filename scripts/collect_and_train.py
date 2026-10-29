#!/usr/bin/env python
"""Coleta dados meteorológicos REAIS e treina o modelo de chuva forte / risco de alagamento.

Uso:
    python scripts/collect_and_train.py [--years 3] [--no-ingest]

O que acontece:
  1. Baixa a série horária histórica de cada região (Open-Meteo Archive / reanálise ERA5)
     e as horas mais recentes (Open-Meteo Forecast `past_days`) — sem chave de API.
  2. Grava tudo no banco da aplicação (`hourly_observations`, upsert incremental).
  3. Treina o modelo (alvo: chuva forte nas próximas horas), avalia com divisão temporal
     contra baselines (climatologia e persistência) e salva em ML_MODEL_PATH.
  4. Registra a execução em `model_runs` (visível em GET /api/v1/ml/runs).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_ROOT))


def _check_deps() -> None:
    missing = []
    for pkg in ("sklearn", "pandas", "numpy", "joblib"):
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"[ERRO] Dependências ausentes: {', '.join(missing)}")
        print("       Execute: pip install -r requirements.txt")
        sys.exit(1)


def _fmt(value: float) -> str:
    return f"{value:.4f}"


async def run(years: int, ingest: bool) -> None:
    from app.db.init_db import init_db
    from app.db.session import AsyncSessionLocal
    from app.services.ml_prediction_service import MLPredictionService
    from app.services.storage_service import StorageService

    print("=" * 64)
    print("  ClimaSP — Treino do modelo de chuva forte com dados reais")
    print("=" * 64)

    await init_db()
    storage = StorageService()
    ml = MLPredictionService(storage=storage, session_factory=AsyncSessionLocal)

    async with AsyncSessionLocal() as session:
        await storage.seed_regions(session)
        if ingest:
            print(f"\n[1/3] Coletando {years} ano(s) de histórico horário (Open-Meteo/ERA5)...")
            summary = await ml.ingest_history(session, years=years)
            print(f"  Janela da reanálise: {summary['archive_window'][0]} → {summary['archive_window'][1]}")
            for code, info in summary["regions"].items():
                print(f"  {code}: {info['hours_upserted']:,} horas gravadas")
        coverage = await ml.observations.coverage(session)
        print("\n  Cobertura no banco:")
        for row in coverage:
            print(f"   {row['region']:<3} {row['source']:<20} {row['hours']:>7,} h  {row['start']} → {row['end']}")

        print("\n[2/3] Treinando (divisão temporal + baselines)...")
        meta = await ml.train(session, years=years, ingest=False, trigger="cli")

    m = meta["metrics"]
    b = m["baseline"]
    print(f"\n[3/3] Modelo {meta['version']} — alvo: {meta['target']}")
    print(f"  Dados: {meta['samples']:,} horas ({meta['data_start'][:10]} → {meta['data_end'][:10]})")
    print(f"  Teste (período mais recente): {m['test_period']['start'][:10]} → {m['test_period']['end'][:10]}")
    print(f"  Taxa de eventos: treino {m['train_positive_rate']:.2%} | teste {m['test_positive_rate']:.2%}")
    print("\n  Métrica               Modelo    Persistência  Climatologia")
    print(f"  ROC-AUC               {_fmt(m['roc_auc'])}    {_fmt(b['persistence_roc_auc'])}        0.5000")
    print(f"  PR-AUC                {_fmt(m['pr_auc'])}    {_fmt(b['persistence_pr_auc'])}        {_fmt(m['test_positive_rate'])}")
    print(f"  Brier                 {_fmt(m['brier'])}    —             {_fmt(b['climatology_brier'])}")
    print(f"  F1 (chuva forte)      {_fmt(m['f1_heavy'])}    {_fmt(b['persistence_f1_heavy'])}        —")
    print(f"  MAE chuva (mm)        {_fmt(m['rain_mae_mm'])}    {_fmt(b['persistence_rain_mae_mm'])}        {_fmt(b['zero_rain_mae_mm'])} (zero)")
    print(f"  Brier skill vs climatologia: {m['brier_skill_vs_climatology']:.3f}")

    print("\n  Importância das features (permutação, PR-AUC):")
    for feat, imp in list(meta["feature_importance"].items())[:12]:
        print(f"   {feat:<22} {imp:.4f}  {'#' * int(min(imp, 0.5) * 80)}")

    print(f"\n  Modelo salvo em: {Path(ml.status()['model_path']).resolve()}")
    print("  A API carrega o modelo na inicialização (ou já usa este, se treinado via /api/v1/ml/train).")


def main() -> None:
    _check_deps()
    parser = argparse.ArgumentParser(description="Coleta dados reais e treina o modelo de chuva forte de SP.")
    parser.add_argument("--years", type=int, default=3, help="Anos de histórico (padrão: 3)")
    parser.add_argument("--no-ingest", action="store_true", help="Treina só com o que já está no banco")
    args = parser.parse_args()
    asyncio.run(run(years=args.years, ingest=not args.no_ingest))


if __name__ == "__main__":
    main()
