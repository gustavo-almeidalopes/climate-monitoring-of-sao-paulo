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


# Emojis e glifos Unicode usados como ícone (alerta, setas, triângulos, marcas, bolinhas).
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF☀-➿⬀-⯿■-◿←-⇿•️]"
)


@pytest.mark.parametrize(
    "path",
    ["index.html", "styles.css", "config.js",
     *sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "js").glob("*.js")),
     *sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "src").glob("*.ts"))],
)
def test_frontend_sem_emojis(path: str) -> None:
    """Interface só com texto e ícones SVG do sprite: nenhum emoji no código do front-end."""
    text = (ROOT / path).read_text(encoding="utf-8")
    found = sorted({m.group() for m in _EMOJI.finditer(text)})
    assert not found, f"{path}: {found}"


@pytest.mark.parametrize("path", ["app", "scripts", "services"])
def test_backend_e_scripts_sem_emojis(path: str) -> None:
    """Mensagens do servidor e dos scripts (inclusive os do Simulador iOS) sem emojis."""
    allowed = {"scripts/build_geodata.py"}  # gera docs/fase-2/fontes.md; alterar dispara nova coleta
    for file in sorted((ROOT / path).rglob("*")):
        if file.suffix not in {".py", ".sh", ".java", ".sql", ".yml"} or file.relative_to(ROOT).as_posix() in allowed \
                or "target" in file.parts:
            continue
        found = sorted({m.group() for m in _EMOJI.finditer(file.read_text(encoding="utf-8"))})
        assert not found, f"{file.relative_to(ROOT)}: {found}"


def test_typescript_compilado_em_js() -> None:
    """Cada módulo src/*.ts tem o js/*.js correspondente (gerado por `npm run build`) e vice-versa."""
    ts = {p.stem for p in (ROOT / "src").glob("*.ts") if not p.name.endswith(".d.ts")}
    js = {p.stem for p in (ROOT / "js").glob("*.js")}
    assert ts == js, f"rode `npm run build`: só em src {sorted(ts - js)}, só em js {sorted(js - ts)}"
