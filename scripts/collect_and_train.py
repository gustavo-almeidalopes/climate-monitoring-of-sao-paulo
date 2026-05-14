#!/usr/bin/env python
"""Script standalone para coleta de dados históricos e treino do modelo ML.

Uso:
    python scripts/collect_and_train.py [--years 2] [--model-path models/flood_risk_model.joblib]

Fontes de dados:
  - Open-Meteo Archive  (https://archive-api.open-meteo.com) — gratuita, sem chave
  - INMET A701          (https://apitempo.inmet.gov.br)       — API pública INMET/Brasil

Labels de alagamento (limiares CEMADEN / Defesa Civil SP):
  - rain_24h > 50 mm   → alerta laranja/vermelho
  - rain_3h  > 20 mm   → chuva intensa em 3 h
  - rain_mm  > 15 mm/h → pico horário crítico
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

# Garante que a raiz do projeto está no sys.path ao rodar com `python scripts/...`
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
        print("       Execute: pip install scikit-learn pandas numpy joblib")
        sys.exit(1)


async def run(years: int, model_path: Path) -> None:
    from app.ml.dataset import collect_training_data
    from app.ml.features import FEATURE_COLUMNS, build_features_dataframe, make_flood_labels
    from app.ml.model import FloodRiskModel

    import numpy as np
    import pandas as pd

    print("=" * 60)
    print("  ClimaSP — Treino do modelo ML de alagamento")
    print("=" * 60)

    # 1. Coleta de dados históricos
    print(f"\n[1/4] Coletando {years} ano(s) de dados históricos...")
    raw_df = await collect_training_data(years=years)

    # 2. Feature engineering por região (janelas temporais são calculadas dentro de cada região)
    print("\n[2/4] Calculando features temporais (rain_3h / 6h / 24h)...")
    region_dfs: list[pd.DataFrame] = []
    for code in raw_df["region_code"].unique():
        rdf = raw_df[raw_df["region_code"] == code].copy()
        rdf = build_features_dataframe(rdf)
        region_dfs.append(rdf)

    df = pd.concat(region_dfs, ignore_index=True).dropna(subset=["rain_3h", "rain_24h"])
    print(f"  Registros após feature engineering: {len(df):,}")

    # 3. Labels
    y = make_flood_labels(df).values
    X = df[FEATURE_COLUMNS].values.astype(float)

    pos_rate = float(y.mean() * 100)
    print(f"  Taxa de amostras positivas (alagamento): {pos_rate:.1f}%")
    if pos_rate < 0.5:
        print("  [AVISO] Taxa positiva muito baixa — verifique os dados de entrada.")

    # 4. Treino
    print(f"\n[3/4] Treinando GradientBoostingClassifier "
          f"({len(X):,} amostras, {len(FEATURE_COLUMNS)} features)...")

    model_path.parent.mkdir(parents=True, exist_ok=True)
    model = FloodRiskModel(model_path=model_path)
    metrics = model.train(X, y)

    # 5. Resultados
    print("\n[4/4] Métricas de avaliação (conjunto de teste 20%):")
    print(f"  ROC-AUC              : {metrics['roc_auc']:.4f}")
    print(f"  Acurácia             : {metrics['accuracy']:.4f}")
    print(f"  Precisão (alagamento): {metrics['precision_flood']:.4f}")
    print(f"  Recall   (alagamento): {metrics['recall_flood']:.4f}")
    print(f"  F1-score (alagamento): {metrics['f1_flood']:.4f}")
    print(f"  Amostras de treino   : {metrics['train_samples']:,}")
    print(f"  Amostras de teste    : {metrics['test_samples']:,}")

    print("\n  Importância das features:")
    for feat, imp in sorted(model.feature_importance.items(), key=lambda x: -x[1]):
        bar = "#" * int(imp * 40)
        print(f"  {feat:<22} {imp:.4f}  {bar}")

    print(f"\n  Modelo salvo em: {model_path.resolve()}")
    print("\nConcluído. Reinicie a API para carregar o modelo automaticamente.")
    print("  Ou chame POST /api/v1/ml/train/sync diretamente na API.")


def main() -> None:
    _check_deps()

    parser = argparse.ArgumentParser(
        description="Coleta dados históricos e treina modelo ML de alagamento para SP."
    )
    parser.add_argument(
        "--years",
        type=int,
        default=2,
        help="Anos de histórico a coletar (padrão: 2, máx recomendado: 5)",
    )
    parser.add_argument(
        "--model-path",
        type=Path,
        default=Path("models/flood_risk_model.joblib"),
        help="Caminho para salvar o modelo treinado",
    )
    args = parser.parse_args()

    asyncio.run(run(years=args.years, model_path=args.model_path))


if __name__ == "__main__":
    main()
