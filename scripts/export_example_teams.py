"""Exporta as equipes de EXEMPLO (fictícias) para data/geo/example-teams.json.

O serviço Java de operação (services/ops-java) semeia o PostGIS a partir deste arquivo, para as
duas implementações terem exatamente as mesmas equipes. A regra de seleção continua num lugar só
(app.services.ops_service.example_teams); o teste tests/test_ops.py garante que o arquivo está em dia.

    python scripts/export_example_teams.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.services.ops_service import example_teams  # noqa: E402

OUT = ROOT / "data" / "geo" / "example-teams.json"


def payload() -> dict:
    teams = [{"code": f"EX-{i:02d}", **t} for i, t in enumerate(example_teams(), start=1)]
    return {
        "note": ("Equipes FICTÍCIAS ([EXEMPLO]) até haver integração com os sistemas reais. As bases ficam em "
                 "instalações reais do OpenStreetMap (ODbL) ou no centro de cada subprefeitura; as equipes não existem. "
                 "Gerado por scripts/export_example_teams.py a partir de app/services/ops_service.example_teams()."),
        "teams": teams,
    }


def main() -> None:
    OUT.write_text(json.dumps(payload(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{len(payload()['teams'])} equipes de exemplo em {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
