"""O FastAPI continua servindo o front-end depois da separação em arquivos."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope="module")
def client() -> TestClient:
    # Sem `with`: não dispara o lifespan (coleta de dados/ML), só as rotas.
    return TestClient(app)


def test_index_html(client: TestClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/html")
    assert 'src="js/main.js"' in resp.text


@pytest.mark.parametrize(
    ("path", "content_type"),
    [("/styles.css", "text/css"), ("/config.js", "text/javascript"), ("/js/main.js", "text/javascript")],
)
def test_static_assets(client: TestClient, path: str, content_type: str) -> None:
    resp = client.get(path)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith(content_type)


def test_every_module_referenced_by_index_is_served(client: TestClient) -> None:
    """Todo import relativo entre os módulos aponta para um arquivo existente e servido."""
    modules = sorted((ROOT / "js").glob("*.js"))
    assert modules, "pasta js/ vazia"
    for module in modules:
        for target in re.findall(r'from\s+"\./([\w-]+\.js)"', module.read_text(encoding="utf-8")):
            assert (ROOT / "js" / target).is_file(), f"{module.name} importa {target}, que não existe"
        assert client.get(f"/js/{module.name}").status_code == 200


def test_viewport_allows_zoom() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    viewport = re.search(r'<meta name="viewport" content="([^"]+)"', html)
    assert viewport, "meta viewport ausente"
    assert "user-scalable=no" not in viewport.group(1)
    assert "maximum-scale" not in viewport.group(1)


def test_api_routes_unchanged(client: TestClient) -> None:
    resp = client.get("/api/v1/weather/thresholds")
    assert resp.status_code == 200
    body = resp.json()
    assert (body["yellow_mm_h"], body["orange_mm_h"], body["red_mm_h"]) == (5.0, 20.0, 40.0)
