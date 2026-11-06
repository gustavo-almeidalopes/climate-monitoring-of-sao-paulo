"""Exporta a especificação OpenAPI do backend Python para docs/api/openapi.json.

API pública documentada para imprensa, prefeituras e pesquisadores. O serviço Java publica a dele
em /api/v1/ops-java/openapi.json (e Swagger em /api/v1/ops-java/docs); pelo gateway, as duas ficam
no mesmo endereço.

    python scripts/export_openapi.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402

OUT = ROOT / "docs" / "api" / "openapi.json"


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    spec = app.openapi()
    OUT.write_text(json.dumps(spec, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"{len(spec['paths'])} rotas em {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
