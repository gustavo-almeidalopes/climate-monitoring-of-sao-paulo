"""Exporta o modelo de chuva forte (scikit-learn) para ONNX.

O treino continua em Python (scikit-learn, pandas, ERA5); o ONNX deixa a PREVISÃO rodar em
qualquer runtime — ONNX Runtime para Java, .NET, JavaScript ou C — sem Python em produção.

Gera, a partir de models/flood_risk_model.joblib:
  models/flood_risk_classifier.onnx   probabilidade de chuva forte (saída "probabilities"[:, 1])
  models/flood_risk_regressor.onnx    chuva esperada nas próximas horas, em mm (saída "variable")
  models/flood_risk_model.onnx.json   ordem das variáveis, limiar de decisão e versão do modelo

Entrada dos dois: tensor float32 [N, 33] com as variáveis na ordem de feature_columns
(NaN = valor ausente, tratado como no scikit-learn). tests/test_onnx_export.py confere que o ONNX
devolve os mesmos números do modelo original.

    pip install -r requirements-dev.txt && python scripts/export_onnx.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"


def _patch_onnx_bool_attributes() -> None:
    """skl2onnx 1.20 + scikit-learn 1.9: as árvores marcam o desvio de valor ausente com
    booleanos numpy, e o onnx 1.23 só aceita inteiros nesse atributo. Converte para 0/1."""
    import onnx.helper as helper

    if getattr(helper.make_attribute, "_climasp_patched", False):
        return
    original = helper.make_attribute

    def make_attribute(key, value, *args, **kwargs):
        if isinstance(value, (list, tuple, np.ndarray)) and len(value) and any(isinstance(v, (bool, np.bool_)) for v in value):
            value = [int(v) if isinstance(v, (bool, np.bool_)) else v for v in value]
        return original(key, value, *args, **kwargs)

    make_attribute._climasp_patched = True
    helper.make_attribute = make_attribute


def _apply_link(model, loss: str):
    """O skl2onnx devolve a soma das árvores (escala da função de ligação). Para perda Poisson
    a ligação é log, então a chuva em mm é exp(soma): acrescenta um nó Exp na saída."""
    if loss != "poisson":
        return model
    from onnx import helper

    graph = model.graph
    out = graph.output[0]
    raw = out.name + "_log"
    for node in graph.node:
        node.output[:] = [raw if o == out.name else o for o in node.output]
    graph.node.append(helper.make_node("Exp", [raw], [out.name], name="poisson_link"))
    return model


def convert(bundle: dict) -> dict[str, bytes]:
    _patch_onnx_bool_attributes()
    from skl2onnx import to_onnx

    n = len(bundle["feature_columns"])
    sample = np.zeros((1, n), dtype=np.float32)
    clf, reg = bundle["classifier"], bundle["regressor"]
    regressor = _apply_link(to_onnx(reg, sample), getattr(reg, "loss", ""))
    return {
        "classifier": to_onnx(clf, sample, options={id(clf): {"zipmap": False}}).SerializeToString(),
        "regressor": regressor.SerializeToString(),
    }


def metadata(bundle: dict) -> dict:
    meta = bundle["metadata"]
    return {
        "format": "onnx",
        "model_version": meta.get("version"),
        "target": meta.get("target"),
        "horizon_hours": meta.get("horizon_hours"),
        "heavy_rain_mm": meta.get("heavy_rain_mm"),
        "decision_threshold": meta.get("metrics", {}).get("decision_threshold"),
        "feature_columns": list(bundle["feature_columns"]),
        "input": {"name": "X", "dtype": "float32", "shape": [None, len(bundle["feature_columns"])], "missing": "NaN"},
        "outputs": {
            "classifier": "probabilities[:, 1] = probabilidade de chuva forte no horizonte",
            "regressor": "variable[:, 0] = chuva esperada (mm) no horizonte",
        },
        "files": {"classifier": "flood_risk_classifier.onnx", "regressor": "flood_risk_regressor.onnx"},
        "note": "Gerado por scripts/export_onnx.py a partir de flood_risk_model.joblib; o treino é em Python.",
    }


def main() -> None:
    import joblib

    bundle = joblib.load(MODELS / "flood_risk_model.joblib")
    blobs = convert(bundle)
    (MODELS / "flood_risk_classifier.onnx").write_bytes(blobs["classifier"])
    (MODELS / "flood_risk_regressor.onnx").write_bytes(blobs["regressor"])
    (MODELS / "flood_risk_model.onnx.json").write_text(
        json.dumps(metadata(bundle), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    sizes = {k: f"{len(v) // 1024} KB" for k, v in blobs.items()}
    print(f"ONNX exportado (modelo {bundle['metadata'].get('version')}): {sizes}")


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    main()
