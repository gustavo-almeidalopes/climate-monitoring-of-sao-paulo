"""Gera as camadas geográficas da Fase 2 a partir de fontes reais e documenta a procedência.

Roda no GitHub Actions (workflow "Dados geográficos"), que tem acesso à internet:

    python scripts/build_geodata.py --out data/geo --report docs/fase-2/fontes.md

Saídas (todas com a fonte registrada em data/geo/metadata.json):

- hex-zona-norte.geojson  grade H3 (res. 9, ~0,1 km² por célula) dos 11 distritos monitorados,
                          com altitude (Copernicus DEM via Open-Meteo), distância ao curso d'água
                          mais próximo (OpenStreetMap) e um índice de suscetibilidade relativo.
- waterways.geojson       rios e córregos (OpenStreetMap).
- flood-streets.geojson   geometria das vias citadas no roadmap como alagáveis (OpenStreetMap).
- support-points.geojson  hospitais e quartéis de bombeiros (OpenStreetMap).
- fontes.md               relatório de sondagem: o que cada fonte (GeoSampa, CGE, RainViewer…)
                          respondeu, para decidir licença/uso antes de incorporar dados.

Nada aqui é inventado: se uma fonte falhar, o campo correspondente fica nulo e o
relatório diz por quê.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import h3
import httpx

DISTRICTS_URL = "https://raw.githubusercontent.com/codigourbano/distritos-sp/master/distritos-sp.geojson"
ELEVATION_URL = "https://api.open-meteo.com/v1/elevation"
OPENTOPODATA_URL = "https://api.opentopodata.org/v1/srtm30m"
GEOSAMPA_WFS = "https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows"
CKAN_SEARCH = "https://dados.prefeitura.sp.gov.br/api/3/action/package_search"
# Camadas do GeoSampa ligadas a alagamento (nomes confirmados no GetCapabilities).
GEOSAMPA_LAYERS = (
    "geoportal:risco_ocorrencia_alagamento",
    "geoportal:risco_ocorrencia_inundacao",
    # geoportal:mancha_inundacao_25 fica de fora: no recorte da Zona Norte passa de 20 mil feições
    # (arquivo truncado e >10 MB); precisa de simplificação antes de ser exibida.
    "geoportal:area_inundavel",
    "geoportal:risco_hidrologico",
)
OVERPASS_URLS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
H3_RES = 9

DISTRICT_TO_REGION = {
    "CASA VERDE": "CV", "CACHOEIRINHA": "CV", "LIMAO": "CV",
    "SANTANA": "ST", "TUCURUVI": "ST", "MANDAQUI": "ST",
    "JACANA": "JT", "TREMEMBE": "JT",
    "VILA MARIA": "MG", "VILA GUILHERME": "MG", "VILA MEDEIROS": "MG",
}

# Vias citadas no roadmap do projeto como exemplos de vias alagáveis. A geometria vem do OSM;
# a classificação "alagável" é do roadmap e precisa ser confirmada com dados do CGE.
FLOOD_STREETS = {
    "Marginal Tietê": r"Marginal.*Tiet[eê]|Marginal do Rio Tiet[eê]",
    "Avenida Braz Leme": r"Br[aá][zs] Leme",
}

PROBES = {
    "GeoSampa — WFS (capabilities)": [
        "https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows?service=WFS&request=GetCapabilities",
        "http://wfs.geosampa.prefeitura.sp.gov.br/geoserver/geoportal/wfs?service=WFS&request=GetCapabilities",
        "https://geosampa.prefeitura.sp.gov.br/geoserver/ows?service=WFS&request=GetCapabilities",
    ],
    "GeoSampa — portal": ["https://geosampa.prefeitura.sp.gov.br/PaginasPublicas/_SBC.aspx"],
    "Dados abertos da Prefeitura — conjuntos do GeoSampa (licença)": [
        "https://dados.prefeitura.sp.gov.br/api/3/action/package_search?q=geosampa&rows=8",
    ],
    "Dados abertos da Prefeitura — alagamento (licença)": [
        "https://dados.prefeitura.sp.gov.br/api/3/action/package_search?q=alagamento&rows=8",
    ],
    "CGE — alagamentos": ["https://www.cgesp.org/v3/alagamentos.jsp"],
    "RainViewer — API": ["https://api.rainviewer.com/public/weather-maps.json"],
    "RainViewer — termos da API": ["https://www.rainviewer.com/api.html"],
}
PROBE_KEYWORDS = re.compile(r"inund|alag|risco|varzea|várzea|hidro|drenag|piscin|reservat|corrego|córrego|enchente", re.I)


def norm(value: str) -> str:
    return unicodedata.normalize("NFD", str(value).upper()).encode("ascii", "ignore").decode().strip()


def log(msg: str) -> None:
    print(f"[geodata] {msg}", flush=True)


# ---------------------------------------------------------------- geometria


def meters_xy(lat: float, lng: float, lat0: float) -> tuple[float, float]:
    """Projeção equiretangular local (precisão de metros na escala de um município)."""
    k = 111_320.0
    return lng * k * math.cos(math.radians(lat0)), lat * k


def point_segment_distance(p, a, b) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def nearest_line(lat: float, lng: float, lines: list[dict], lat0: float) -> tuple[float | None, str | None]:
    p = meters_xy(lat, lng, lat0)
    best, best_name = None, None
    for line in lines:
        pts = line["xy"]
        for a, b in zip(pts, pts[1:]):
            d = point_segment_distance(p, a, b)
            if best is None or d < best:
                best, best_name = d, line["name"]
    return best, best_name


def percentile_ranks(values: list[float]) -> list[float]:
    """Posição relativa 0..1 de cada valor (0 = menor)."""
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    n = max(1, len(values) - 1)
    for pos, i in enumerate(order):
        ranks[i] = pos / n
    return ranks


def susceptibility(cells: list[dict]) -> None:
    """Índice relativo 0..1 de suscetibilidade a alagamento, por célula (EXPERIMENTAL).

    - terreno baixo: média de (a) quão baixa é a célula na área monitorada e (b) quão abaixo
      está da vizinhança imediata (anel H3 k=2) — fundos de vale acumulam água;
    - proximidade de curso d'água: exp(-d / 300 m).
    - histórico: ocorrências de alagamento registradas pela Prefeitura (GeoSampa,
      risco_ocorrencia_alagamento) na célula e vizinhas (anel k=1), normalizado por log.
    Sem histórico: s = 0,5 * terreno_baixo + 0,5 * proximidade.
    Com histórico: s = 0,35 * terreno_baixo + 0,35 * proximidade + 0,30 * histórico.
    """
    elev = {c["h3"]: c["elev_m"] for c in cells if c["elev_m"] is not None}
    if len(elev) < len(cells) * 0.9:
        log("altitude incompleta — suscetibilidade não calculada")
        return
    rel = []
    for c in cells:
        ring = [elev[n] for n in h3.grid_disk(c["h3"], 2) if n in elev and n != c["h3"]]
        c["rel_elev_m"] = round(c["elev_m"] - sum(ring) / len(ring), 1) if ring else 0.0
        rel.append(c["rel_elev_m"])
    abs_rank = percentile_ranks([c["elev_m"] for c in cells])
    rel_rank = percentile_ranks(rel)
    max_occ = max((c.get("occurrences") or 0) for c in cells)
    for c, ra, rr in zip(cells, abs_rank, rel_rank):
        low = 1.0 - (ra + rr) / 2.0
        near = math.exp(-c["dist_stream_m"] / 300.0) if c.get("dist_stream_m") is not None else 0.0
        c["low_terrain"] = round(low, 3)
        c["near_stream"] = round(near, 3)
        if max_occ > 0:
            hist = math.log1p(c.get("occurrences") or 0) / math.log1p(max_occ)
            c["history"] = round(hist, 3)
            c["susc"] = round(0.35 * low + 0.35 * near + 0.30 * hist, 3)
        else:
            c["susc"] = round(0.5 * low + 0.5 * near, 3)


# ---------------------------------------------------------------- fontes


def representative_point(geom: dict | None) -> tuple[float, float] | None:
    """Ponto representativo (lat, lng) de uma geometria GeoJSON: o ponto, ou a média dos vértices."""
    if not geom:
        return None
    coords = geom.get("coordinates")
    flat: list[list[float]] = []

    def walk(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            flat.append(c)
        elif isinstance(c, (list, tuple)):
            for x in c:
                walk(x)

    walk(coords)
    if not flat:
        return None
    return sum(p[1] for p in flat) / len(flat), sum(p[0] for p in flat) / len(flat)


def geosampa_layer(client: httpx.Client, layer: str, bbox: tuple[float, float, float, float]) -> list[dict]:
    south, west, north, east = bbox
    params = {
        "service": "WFS", "version": "1.0.0", "request": "GetFeature", "typeName": layer,
        "outputFormat": "application/json", "srsName": "EPSG:4326", "maxFeatures": "20000",
        "bbox": f"{west},{south},{east},{north},EPSG:4326",
    }
    resp = client.get(GEOSAMPA_WFS, params=params, timeout=180)
    resp.raise_for_status()
    feats = resp.json().get("features", [])
    for f in feats:
        f.pop("id", None)
        f["geometry"] = round_geometry(f.get("geometry"))
    return feats


def round_geometry(geom: dict | None) -> dict | None:
    if not geom:
        return geom

    def rnd(c):
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            return [round(c[0], 5), round(c[1], 5)]
        return [rnd(x) for x in c]

    return {"type": geom["type"], "coordinates": rnd(geom["coordinates"])}


def get_districts(client: httpx.Client) -> list[dict]:
    data = client.get(DISTRICTS_URL, timeout=60).raise_for_status().json()
    out = []
    for f in data["features"]:
        name = norm(f["properties"].get("ds_nome", ""))
        if name in DISTRICT_TO_REGION:
            out.append({"name": name, "region": DISTRICT_TO_REGION[name], "geometry": f["geometry"]})
    log(f"{len(out)} distritos monitorados")
    return out


def district_cells(districts: list[dict]) -> list[dict]:
    cells: dict[str, dict] = {}
    for d in districts:
        geom = d["geometry"]
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        for rings in polys:
            outer = [(lat, lng) for lng, lat in rings[0]]
            holes = [[(lat, lng) for lng, lat in r] for r in rings[1:]]
            for cell in h3.polygon_to_cells(h3.LatLngPoly(outer, *holes), H3_RES):
                lat, lng = h3.cell_to_latlng(cell)
                cells.setdefault(cell, {"h3": cell, "lat": round(lat, 6), "lng": round(lng, 6),
                                        "district": d["name"], "region": d["region"]})
    log(f"{len(cells)} células H3 res {H3_RES}")
    return sorted(cells.values(), key=lambda c: c["h3"])


def _elevation_open_meteo(client: httpx.Client, chunk: list[dict]) -> list[float | None]:
    params = {"latitude": ",".join(str(c["lat"]) for c in chunk),
              "longitude": ",".join(str(c["lng"]) for c in chunk)}
    resp = client.get(ELEVATION_URL, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()["elevation"]


def _elevation_opentopodata(client: httpx.Client, chunk: list[dict]) -> list[float | None]:
    locations = "|".join(f"{c['lat']},{c['lng']}" for c in chunk)
    resp = client.get(OPENTOPODATA_URL, params={"locations": locations}, timeout=60)
    resp.raise_for_status()
    return [r.get("elevation") for r in resp.json()["results"]]


ELEVATION_SOURCES = {
    "open-meteo": (_elevation_open_meteo, "Copernicus DEM GLO-90 (90 m) via Open-Meteo Elevation API",
                   "CC BY 4.0 (Open-Meteo); © DLR e.V. 2010-2014 e © Airbus Defence and Space GmbH 2014-2018, "
                   "fornecido no âmbito do COPERNICUS pela União Europeia e ESA"),
    "opentopodata": (_elevation_opentopodata, "SRTM GL1 (30 m) via Open Topo Data (api.opentopodata.org)",
                     "SRTM: domínio público (NASA/USGS); serviço Open Topo Data"),
}


def fetch_elevation(client: httpx.Client, cells: list[dict]) -> tuple[str | None, str | None]:
    """Tenta cada fonte em ordem, com espaçamento e backoff para respeitar os limites de uso.
    Devolve (fonte usada, erro)."""
    errors = []
    for key, (fetch, _, _) in ELEVATION_SOURCES.items():
        ok = True
        for i in range(0, len(cells), 100):
            chunk = cells[i:i + 100]
            for attempt in range(6):
                try:
                    values = fetch(client, chunk)
                    for c, e in zip(chunk, values):
                        c["elev_m"] = None if e is None else round(float(e), 1)
                    break
                except Exception as exc:  # noqa: BLE001
                    if attempt == 5:
                        errors.append(f"{key}: {exc}")
                        ok = False
                    else:
                        time.sleep(min(90, 10 * 2 ** attempt))
            if not ok:
                break
            time.sleep(1.5)
        if ok:
            log(f"altitude ok ({key})")
            return key, None
        for c in cells:
            c["elev_m"] = None
    return None, "falha na altitude: " + " | ".join(e[:300] for e in errors)


def overpass(client: httpx.Client, query: str) -> dict:
    last = None
    for url in OVERPASS_URLS:
        for attempt in range(3):
            try:
                resp = client.post(url, data={"data": query}, timeout=180)
                resp.raise_for_status()
                return resp.json()
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Overpass indisponível: {last}")


def ways_to_features(elements: list[dict], props) -> list[dict]:
    feats = []
    for el in elements:
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [[round(p["lon"], 5), round(p["lat"], 5)] for p in el["geometry"]]
        if len(coords) < 2:
            continue
        feats.append({"type": "Feature", "properties": props(el),
                      "geometry": {"type": "LineString", "coordinates": coords}})
    return feats


def bbox_of(cells: list[dict], margin: float = 0.01) -> tuple[float, float, float, float]:
    lats = [c["lat"] for c in cells]
    lngs = [c["lng"] for c in cells]
    return min(lats) - margin, min(lngs) - margin, max(lats) + margin, max(lngs) + margin


def probe(client: httpx.Client) -> list[str]:
    lines = []
    for title, urls in PROBES.items():
        lines.append(f"### {title}\n")
        for url in urls:
            try:
                resp = client.get(url, timeout=40, follow_redirects=True)
                text = resp.text
                lines.append(f"- `{url}` → HTTP {resp.status_code}, {len(text)} bytes, `{resp.headers.get('content-type', '')}`")
                if "GetCapabilities" in url and resp.status_code == 200:
                    for tag in ("Fees", "AccessConstraints", "Title", "Abstract"):
                        m = re.search(rf"<(?:ows:)?{tag}>([^<]*)</(?:ows:)?{tag}>", text)
                        if m:
                            lines.append(f"  - {tag}: “{m.group(1).strip()[:300]}”")
                    for layer in GEOSAMPA_LAYERS:
                        m = re.search(rf"<Name>{re.escape(layer)}</Name>\s*<Title>([^<]*)</Title>(?:\s*<Abstract>([^<]*)</Abstract>)?", text)
                        if m:
                            lines.append(f"  - `{layer}`: {m.group(1).strip()} — {(m.group(2) or '').strip()[:300]}")
                    names = re.findall(r"<(?:wfs:)?Name>([^<]+)</(?:wfs:)?Name>", text)
                    hits = [n for n in names if PROBE_KEYWORDS.search(n)]
                    lines.append(f"  - {len(names)} camadas; relacionadas a água/risco: "
                                 + (", ".join(f"`{h}`" for h in hits[:80]) or "nenhuma"))
                elif "package_search" in url and resp.status_code == 200:
                    for pkg in resp.json().get("result", {}).get("results", [])[:8]:
                        lines.append(f"  - pacote `{pkg.get('name')}` ({pkg.get('title')}): licença **{pkg.get('license_title')}** "
                                     f"({pkg.get('license_url') or pkg.get('license_id')})")
                elif "rainviewer.com/public" in url and resp.status_code == 200:
                    data = resp.json()
                    past = data.get("radar", {}).get("past", [])
                    lines.append(f"  - host `{data.get('host')}`; {len(past)} quadros de radar recentes")
                else:
                    licence = re.findall(r"[^.<>]{0,160}(?:licen[çc]a|license|termos de uso|terms of use|creative commons|odbl|atribui)[^.<>]{0,200}", text, re.I)
                    for snippet in licence[:4]:
                        lines.append(f"  - trecho: “{' '.join(snippet.split())[:300]}”")
                break
            except Exception as exc:  # noqa: BLE001
                lines.append(f"- `{url}` → erro: {exc}")
        lines.append("")
    return lines


# ---------------------------------------------------------------- main


def write_geojson(path: Path, features: list[dict]) -> None:
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features},
                               ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/geo")
    ap.add_argument("--report", default="docs/fase-2/fontes.md")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    Path(args.report).parent.mkdir(parents=True, exist_ok=True)

    now = datetime.now(tz=timezone.utc).isoformat(timespec="seconds")
    notes: list[str] = []
    meta: dict = {"generated_at": now, "h3_resolution": H3_RES, "sources": {}, "counts": {}, "notes": notes}

    with httpx.Client(headers={"User-Agent": "ClimaSP-geodata (github.com/gustavo-almeidalopes/climate-monitoring-of-sao-paulo)"}) as client:
        districts = get_districts(client)
        cells = district_cells(districts)
        for c in cells:
            c.update({"elev_m": None, "dist_stream_m": None, "nearest_stream": None})
        meta["sources"]["distritos"] = {
            "url": DISTRICTS_URL,
            "origem": "GeoSampa (SMDU/PMSP) via codigourbano/distritos-sp",
            "uso": "apenas para selecionar as células e atribuir distrito/região",
        }

        used, err = fetch_elevation(client, cells)
        if err:
            notes.append(err)
        if used:
            _, dataset, licence = ELEVATION_SOURCES[used]
            meta["sources"]["altitude"] = {"fonte": used, "dataset": dataset, "licenca": licence}

        south, west, north, east = bbox_of(cells)
        bbox = f"{south},{west},{north},{east}"
        lat0 = (south + north) / 2
        osm_license = "© colaboradores do OpenStreetMap — ODbL 1.0 (https://www.openstreetmap.org/copyright)"

        try:
            data = overpass(client, f'[out:json][timeout:150];way["waterway"~"^(river|stream|canal|drain|ditch)$"]({bbox});out geom tags;')
            water = ways_to_features(data["elements"], lambda el: {
                "name": el.get("tags", {}).get("name"),
                "kind": el.get("tags", {}).get("waterway"),
                "covered": el.get("tags", {}).get("tunnel") in ("culvert", "yes") or el.get("tags", {}).get("covered") == "yes",
            })
            write_geojson(out / "waterways.geojson", water)
            lines = [{"name": f["properties"]["name"] or "curso d'água sem nome",
                      "xy": [meters_xy(lat, lng, lat0) for lng, lat in f["geometry"]["coordinates"]]} for f in water]
            for c in cells:
                d, name = nearest_line(c["lat"], c["lng"], lines, lat0)
                c["dist_stream_m"] = None if d is None else round(d)
                c["nearest_stream"] = name
            meta["counts"]["waterways"] = len(water)
            log(f"{len(water)} cursos d'água")
        except Exception as exc:  # noqa: BLE001
            notes.append(f"cursos d'água: {exc}")
        meta["sources"]["cursos_dagua"] = {"consulta": "Overpass API, waterway=river|stream|canal|drain|ditch", "licenca": osm_license}

        susceptibility(cells)

        try:
            regex = "|".join(f"({r})" for r in FLOOD_STREETS.values())
            data = overpass(client, f'[out:json][timeout:150];way["highway"]["name"~"{regex}",i]({bbox});out geom tags;')
            def street_props(el):
                name = el.get("tags", {}).get("name", "")
                label = next((k for k, r in FLOOD_STREETS.items() if re.search(r, name, re.I)), name)
                return {"name": name, "group": label,
                        "fonte_classificacao": "Exemplo citado no roadmap do ClimaSP — confirmar com histórico do CGE"}
            streets = ways_to_features(data["elements"], street_props)
            write_geojson(out / "flood-streets.geojson", streets)
            meta["counts"]["flood_streets"] = len(streets)
            log(f"{len(streets)} trechos de vias")
        except Exception as exc:  # noqa: BLE001
            notes.append(f"vias alagáveis: {exc}")
        meta["sources"]["vias"] = {"consulta": "Overpass API, highway com nome " + ", ".join(FLOOD_STREETS), "licenca": osm_license}

        try:
            data = overpass(client, f'[out:json][timeout:150];nwr["amenity"~"^(hospital|fire_station)$"]({bbox});out center tags;')
            points = []
            for el in data["elements"]:
                lat = el.get("lat") or el.get("center", {}).get("lat")
                lng = el.get("lon") or el.get("center", {}).get("lon")
                if lat is None or lng is None:
                    continue
                tags = el.get("tags", {})
                points.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
                               "properties": {"kind": tags.get("amenity"), "name": tags.get("name"),
                                              "osm": f"{el['type']}/{el['id']}"}})
            write_geojson(out / "support-points.geojson", points)
            meta["counts"]["support_points"] = len(points)
            log(f"{len(points)} pontos de apoio")
        except Exception as exc:  # noqa: BLE001
            notes.append(f"pontos de apoio: {exc}")
        meta["sources"]["pontos_de_apoio"] = {"consulta": "Overpass API, amenity=hospital|fire_station", "licenca": osm_license}

        geosampa_dir = out / "geosampa"
        geosampa_dir.mkdir(exist_ok=True)
        meta["sources"]["geosampa"] = {"wfs": GEOSAMPA_WFS, "camadas": {}}
        for layer in GEOSAMPA_LAYERS:
            try:
                feats = geosampa_layer(client, layer, (south, west, north, east))
                name = layer.split(":")[1]
                write_geojson(geosampa_dir / f"{name}.geojson", feats)
                meta["sources"]["geosampa"]["camadas"][layer] = len(feats)
                log(f"GeoSampa {layer}: {len(feats)} feições")
            except Exception as exc:  # noqa: BLE001
                notes.append(f"GeoSampa {layer}: {exc}")
        occurrences = []
        occ_path = geosampa_dir / "risco_ocorrencia_alagamento.geojson"
        if occ_path.exists():
            for f in json.loads(occ_path.read_text(encoding="utf-8"))["features"]:
                pt = representative_point(f.get("geometry"))
                if pt:
                    occurrences.append(pt)
        if occurrences:
            counts: dict[str, int] = {}
            for lat, lng in occurrences:
                cell = h3.latlng_to_cell(lat, lng, H3_RES)
                counts[cell] = counts.get(cell, 0) + 1
            for c in cells:
                c["occurrences"] = sum(counts.get(n, 0) for n in h3.grid_disk(c["h3"], 1))
            susceptibility(cells)  # recalcula incluindo o histórico de ocorrências

        hex_feats = []
        for c in cells:
            boundary = [[round(lng, 5), round(lat, 5)] for lat, lng in h3.cell_to_boundary(c["h3"])]
            boundary.append(boundary[0])
            props = {k: c.get(k) for k in ("h3", "region", "district", "elev_m", "rel_elev_m", "dist_stream_m",
                                            "nearest_stream", "low_terrain", "near_stream", "occurrences", "history", "susc")}
            hex_feats.append({"type": "Feature", "properties": props, "geometry": {"type": "Polygon", "coordinates": [boundary]}})
        write_geojson(out / "hex-zona-norte.geojson", hex_feats)
        meta["counts"]["cells"] = len(hex_feats)
        meta["susceptibility_formula"] = susceptibility.__doc__.strip()

        report = [f"# Fontes de dados geográficos — sondagem de {now}\n",
                  "Gerado por `scripts/build_geodata.py` no GitHub Actions. Serve para verificar disponibilidade "
                  "e licença antes de incorporar qualquer camada (nada é usado sem fonte verificada).\n",
                  "## Camadas geradas\n"]
        for key, value in meta["counts"].items():
            report.append(f"- `{key}`: {value}")
        report.append("\n## Problemas\n")
        report.extend(f"- {n}" for n in notes) if notes else report.append("- nenhum")
        report.append("\n## Sondagem de fontes externas\n")
        report.extend(probe(client))

    (out / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    Path(args.report).write_text("\n".join(report) + "\n", encoding="utf-8")
    log("ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
