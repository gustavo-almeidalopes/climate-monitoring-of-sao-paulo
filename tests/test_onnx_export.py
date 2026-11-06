"""O modelo exportado para ONNX devolve os mesmos números do modelo scikit-learn."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ort = pytest.importorskip("onnxruntime")
joblib = pytest.importorskip("joblib")

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"


@pytest.fixture(scope="module")
def bundle():
    return joblib.load(MODELS / "flood_risk_model.joblib")


def _inputs(n_features: int) -> np.ndarray:
    """Entradas variadas: valores típicos, extremos e ausentes (NaN), em float32 como no ONNX."""
    rng = np.random.default_rng(42)
    X = rng.normal(size=(3000, n_features)).astype(np.float32) * 8
    X[:, :10] = np.abs(X[:, :10])          # chuvas não são negativas
    X[::9, 3] = np.nan                     # ausentes
    X[::13, 18] = np.nan
    X[:50] = 0.0                           # tempo seco
    return X


def _run(path: Path, X: np.ndarray) -> list[np.ndarray]:
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    return session.run(None, {session.get_inputs()[0].name: X})


def test_arquivos_onnx_versionados_correspondem_ao_modelo(bundle):
    meta = json.loads((MODELS / "flood_risk_model.onnx.json").read_text(encoding="utf-8"))
    assert meta["model_version"] == bundle["metadata"]["version"], "rode: python scripts/export_onnx.py"
    assert meta["feature_columns"] == list(bundle["feature_columns"])


def test_probabilidade_igual_ao_scikit_learn(bundle):
    X = _inputs(len(bundle["feature_columns"]))
    expected = bundle["classifier"].predict_proba(X)[:, 1]
    labels, proba = _run(MODELS / "flood_risk_classifier.onnx", X)
    np.testing.assert_allclose(proba[:, 1], expected, atol=1e-5)
    threshold = bundle["metadata"]["metrics"]["decision_threshold"]
    away = np.abs(expected - threshold) > 1e-5   # longe do limiar, a decisão de alerta é idêntica
    assert np.array_equal(proba[away, 1] >= threshold, expected[away] >= threshold)


def test_chuva_esperada_igual_ao_scikit_learn(bundle):
    X = _inputs(len(bundle["feature_columns"]))
    expected = bundle["regressor"].predict(X)
    (got,) = _run(MODELS / "flood_risk_regressor.onnx", X)
    np.testing.assert_allclose(got.ravel(), expected, rtol=1e-4, atol=1e-5)


def test_exportacao_reproduzivel(bundle):
    """O script gera o mesmo ONNX a partir do mesmo joblib (o arquivo versionado está em dia)."""
    sys.path.insert(0, str(ROOT / "scripts"))
    from export_onnx import convert

    blobs = convert(bundle)
    X = _inputs(len(bundle["feature_columns"]))[:200]
    for name, path in (("classifier", "flood_risk_classifier.onnx"), ("regressor", "flood_risk_regressor.onnx")):
        session = ort.InferenceSession(blobs[name], providers=["CPUExecutionProvider"])
        fresh = session.run(None, {session.get_inputs()[0].name: X})
        stored = _run(MODELS / path, X)
        np.testing.assert_allclose(fresh[-1], stored[-1], atol=1e-6)
