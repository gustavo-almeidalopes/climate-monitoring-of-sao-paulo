"""Operação (Fase 3): equipes, despacho, ocorrências, relatório pós-evento e acerto do modelo."""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.constants import REGION_SEEDS
from app.models.hourly_observation import HourlyObservation
from app.models.ops import INCIDENT_STATUSES, TEAM_KINDS, TEAM_STATUSES, Incident, IncidentEvent, NowcastLog, Team
from app.models.weather_reading import WeatherReading
from app.services.exceptions import NotFoundError, ServiceError

BASE_DIR = Path(__file__).resolve().parent.parent.parent
OSM = "OpenStreetMap (ODbL)"


class ConflictError(ServiceError):
    """Transição de estado inválida (ex.: despachar equipe ocupada)."""


def _now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = math.pi / 180
    a = math.sin((lat2 - lat1) * r / 2) ** 2 + math.cos(lat1 * r) * math.cos(lat2 * r) * math.sin((lng2 - lng1) * r / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(a))


@lru_cache(maxsize=1)
def _cells() -> list[tuple[float, float, str, str]]:
    """Centros das células H3 (lat, lng, região, distrito) — para saber em que região cai um ponto."""
    path = BASE_DIR / get_settings().geo_data_dir / "hex-zona-norte.geojson"
    if not path.exists():
        return []
    out = []
    for f in json.loads(path.read_text(encoding="utf-8"))["features"]:
        ring = f["geometry"]["coordinates"][0]
        lng = sum(c[0] for c in ring) / len(ring)
        lat = sum(c[1] for c in ring) / len(ring)
        out.append((lat, lng, f["properties"]["region"], f["properties"]["district"]))
    return out


def region_at(lat: float, lng: float, max_km: float = 0.45) -> str | None:
    best = None
    for clat, clng, region, _ in _cells():
        d = _km(lat, lng, clat, clng)
        if d <= max_km and (best is None or d < best[0]):
            best = (d, region)
    return best[1] if best else None


# ------------------------------------------------------------------ equipes de exemplo


def example_teams() -> list[dict]:
    """Equipes FICTÍCIAS. As bases ficam em instalações reais do OSM (quartéis e hospitais
    dentro da área monitorada) ou no centro de cada subprefeitura; as equipes não existem."""
    teams: list[dict] = []
    path = BASE_DIR / get_settings().geo_data_dir / "support-points.geojson"
    points = json.loads(path.read_text(encoding="utf-8"))["features"] if path.exists() else []

    def inside(lat: float, lng: float) -> bool:
        return region_at(lat, lng, max_km=0.6) is not None

    stations = [p for p in points if p["properties"]["kind"] == "fire_station"]
    hospitals = [p for p in points if p["properties"]["kind"] == "hospital" and p["properties"].get("name")]
    n = 0
    for p in stations:
        lng, lat = p["geometry"]["coordinates"]
        if not inside(lat, lng):
            continue
        n += 1
        teams.append({"kind": "bombeiros", "name": f"[EXEMPLO] Bombeiros {n}",
                      "base_name": p["properties"].get("name") or "Quartel de bombeiros (sem nome no OSM)",
                      "base_source": f"{OSM} · {p['properties']['osm']}", "lat": lat, "lng": lng})
    n = 0
    for p in hospitals:
        lng, lat = p["geometry"]["coordinates"]
        if n >= 4 or not inside(lat, lng):
            continue
        n += 1
        teams.append({"kind": "samu", "name": f"[EXEMPLO] SAMU {n}", "base_name": p["properties"]["name"],
                      "base_source": f"{OSM} · {p['properties']['osm']}", "lat": lat, "lng": lng})
    for i, seed in enumerate(REGION_SEEDS, start=1):
        center = f"centro aproximado da {seed['name']}"
        teams.append({"kind": "defesa_civil", "name": f"[EXEMPLO] Defesa Civil {seed['short_name']}",
                      "base_name": center, "base_source": "coordenada de referência do ClimaSP (app/core/constants.py)",
                      "lat": seed["latitude"] + 0.003, "lng": seed["longitude"]})
        teams.append({"kind": "subprefeitura", "name": f"[EXEMPLO] Zeladoria {seed['short_name']}",
                      "base_name": center, "base_source": "coordenada de referência do ClimaSP (app/core/constants.py)",
                      "lat": seed["latitude"] - 0.003, "lng": seed["longitude"] + 0.002})
    for i, seed in enumerate([s for s in REGION_SEEDS if s["code"] in ("ST", "MG")], start=1):
        teams.append({"kind": "cet", "name": f"[EXEMPLO] CET {i}", "base_name": f"ponto fictício em {seed['short_name']}",
                      "base_source": "posição fictícia", "lat": seed["latitude"] - 0.006, "lng": seed["longitude"] - 0.004})
    return teams


async def seed_example_teams(session: AsyncSession) -> int:
    if not get_settings().ops_seed_examples:
        return 0
    if await session.scalar(select(func.count(Team.id))):
        return 0
    rows = example_teams()
    for i, t in enumerate(rows, start=1):
        session.add(Team(code=f"EX-{i:02d}", name=t["name"], kind=t["kind"], base_name=t["base_name"],
                         base_source=t["base_source"], base_lat=t["lat"], base_lng=t["lng"], lat=t["lat"],
                         lng=t["lng"], status="disponivel", is_example=True, updated_at=_now()))
    await session.commit()
    return len(rows)


# ------------------------------------------------------------------ serialização


def team_out(t: Team) -> dict:
    return {"id": t.id, "code": t.code, "name": t.name, "kind": t.kind, "status": t.status,
            "lat": t.lat, "lng": t.lng, "base_name": t.base_name, "base_source": t.base_source,
            "base_lat": t.base_lat, "base_lng": t.base_lng, "is_example": t.is_example,
            "updated_at": _utc(t.updated_at)}


def incident_out(i: Incident, events: list[IncidentEvent]) -> dict:
    return {"id": i.id, "kind": i.kind, "description": i.description, "address": i.address, "lat": i.lat,
            "lng": i.lng, "region": i.region_code, "status": i.status, "team_id": i.team_id,
            "eta_minutes": i.eta_minutes, "opened_at": _utc(i.opened_at), "assigned_at": _utc(i.assigned_at),
            "arrived_at": _utc(i.arrived_at), "resolved_at": _utc(i.resolved_at), "is_example": i.is_example,
            "timeline": [{"at": _utc(e.at), "kind": e.kind, "team_id": e.team_id, "note": e.note,
                          "actor_role": e.actor_role} for e in events]}


# ------------------------------------------------------------------ equipes


async def list_teams(session: AsyncSession) -> list[dict]:
    rows = (await session.scalars(select(Team).order_by(Team.kind, Team.id))).all()
    return [team_out(t) for t in rows]


async def update_team(session: AsyncSession, team_id: int, *, status: str | None, lat: float | None,
                      lng: float | None) -> dict:
    team = await session.get(Team, team_id)
    if team is None:
        raise NotFoundError(f"Equipe {team_id} não encontrada.")
    if status is not None:
        if status not in TEAM_STATUSES:
            raise ConflictError(f"Status inválido: {status}.")
        team.status = status
    if lat is not None and lng is not None:
        team.lat, team.lng = lat, lng
    team.updated_at = _now()
    await session.commit()
    return team_out(team)


# ------------------------------------------------------------------ ocorrências


async def _events(session: AsyncSession, incident_id: int) -> list[IncidentEvent]:
    return list((await session.scalars(
        select(IncidentEvent).where(IncidentEvent.incident_id == incident_id).order_by(IncidentEvent.at, IncidentEvent.id)
    )).all())


async def _get_incident(session: AsyncSession, incident_id: int) -> Incident:
    inc = await session.get(Incident, incident_id)
    if inc is None:
        raise NotFoundError(f"Ocorrência {incident_id} não encontrada.")
    return inc


async def list_incidents(session: AsyncSession, *, include_resolved: bool = True, limit: int = 100) -> list[dict]:
    stmt = select(Incident).order_by(Incident.opened_at.desc()).limit(limit)
    if not include_resolved:
        stmt = stmt.where(Incident.status != "resolvida")
    rows = (await session.scalars(stmt)).all()
    return [incident_out(i, await _events(session, i.id)) for i in rows]


async def open_incident(session: AsyncSession, *, lat: float, lng: float, kind: str, description: str,
                        address: str, role: str) -> dict:
    now = _now()
    inc = Incident(kind=kind or "alagamento", description=description[:500], address=address[:200], lat=lat, lng=lng,
                   region_code=region_at(lat, lng), status="aberta", opened_at=now)
    session.add(inc)
    await session.flush()
    session.add(IncidentEvent(incident_id=inc.id, at=now, kind="aberta", note=description[:300], actor_role=role))
    await session.commit()
    return incident_out(inc, await _events(session, inc.id))


async def assign_team(session: AsyncSession, incident_id: int, team_id: int, *, eta_minutes: float | None,
                      role: str) -> dict:
    inc = await _get_incident(session, incident_id)
    if inc.status == "resolvida":
        raise ConflictError("Ocorrência já resolvida.")
    team = await session.get(Team, team_id)
    if team is None:
        raise NotFoundError(f"Equipe {team_id} não encontrada.")
    if team.status != "disponivel":
        raise ConflictError(f"{team.name} não está disponível ({team.status}).")
    now = _now()
    if inc.team_id and inc.team_id != team_id:
        previous = await session.get(Team, inc.team_id)
        if previous and previous.status in ("em_deslocamento", "em_ocorrencia"):
            previous.status = "disponivel"
            previous.updated_at = now
    team.status = "em_deslocamento"
    team.updated_at = now
    inc.team_id = team_id
    inc.status = "despachada"
    inc.assigned_at = inc.assigned_at or now
    inc.eta_minutes = eta_minutes
    note = f"{team.name}" + (f" · chegada estimada em {eta_minutes:.0f} min" if eta_minutes is not None else "")
    session.add(IncidentEvent(incident_id=inc.id, at=now, kind="equipe_designada", team_id=team_id, note=note, actor_role=role))
    await session.commit()
    return incident_out(inc, await _events(session, inc.id))


async def arrive(session: AsyncSession, incident_id: int, *, role: str) -> dict:
    inc = await _get_incident(session, incident_id)
    if inc.status != "despachada" or inc.team_id is None:
        raise ConflictError("A ocorrência precisa ter equipe designada.")
    now = _now()
    team = await session.get(Team, inc.team_id)
    if team:
        team.status, team.lat, team.lng, team.updated_at = "em_ocorrencia", inc.lat, inc.lng, now
    inc.status, inc.arrived_at = "no_local", now
    session.add(IncidentEvent(incident_id=inc.id, at=now, kind="no_local", team_id=inc.team_id, note="Equipe no local", actor_role=role))
    await session.commit()
    return incident_out(inc, await _events(session, inc.id))


async def resolve(session: AsyncSession, incident_id: int, *, note: str, role: str) -> dict:
    inc = await _get_incident(session, incident_id)
    if inc.status == "resolvida":
        raise ConflictError("Ocorrência já resolvida.")
    now = _now()
    if inc.team_id:
        team = await session.get(Team, inc.team_id)
        if team and team.status in ("em_deslocamento", "em_ocorrencia"):
            team.status, team.updated_at = "disponivel", now
    inc.status, inc.resolved_at = "resolvida", now
    session.add(IncidentEvent(incident_id=inc.id, at=now, kind="resolvida", team_id=inc.team_id, note=note[:300], actor_role=role))
    await session.commit()
    return incident_out(inc, await _events(session, inc.id))


# ------------------------------------------------------------------ nowcast e relatório


async def log_nowcast(session: AsyncSession, region_code: str, nowcast: dict) -> None:
    """Guarda o nowcast servido (uma linha por região e hora) para medir o acerto depois."""
    as_of = _utc(nowcast["as_of"]).replace(minute=0, second=0, microsecond=0)
    exists = await session.scalar(select(NowcastLog.id).where(NowcastLog.region_code == region_code, NowcastLog.as_of == as_of))
    if exists:
        return
    session.add(NowcastLog(region_code=region_code, as_of=as_of, probability=float(nowcast["heavy_rain_probability"]),
                           alert=bool(nowcast["heavy_rain_alert"]), heavy_rain_mm=float(nowcast.get("heavy_rain_mm") or 10.0),
                           horizon_hours=int(nowcast.get("horizon_hours") or 3)))
    await session.commit()


def _mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


async def report(session: AsyncSession, *, hours: int) -> dict:
    """Relatório pós-evento da janela [agora − hours, agora]."""
    end = _now()
    start = end - timedelta(hours=hours)
    context = await report_context(session, start=start, end=end)
    incidents = (await session.scalars(select(Incident).where(Incident.opened_at > start))).all()
    by_status = {s: 0 for s in INCIDENT_STATUSES}
    for i in incidents:
        by_status[i.status] = by_status.get(i.status, 0) + 1
    minutes = lambda a, b: (_utc(b) - _utc(a)).total_seconds() / 60  # noqa: E731
    dispatch = [minutes(i.opened_at, i.assigned_at) for i in incidents if i.assigned_at]
    arrival = [minutes(i.opened_at, i.arrived_at) for i in incidents if i.arrived_at]
    resolution = [minutes(i.opened_at, i.resolved_at) for i in incidents if i.resolved_at]
    return {
        "start": start, "end": end, "hours": hours,
        "rain": context["rain"],
        "incidents": {"total": len(incidents), "by_status": by_status,
                      "mean_minutes_to_dispatch": _mean(dispatch), "mean_minutes_to_arrival": _mean(arrival),
                      "mean_minutes_to_resolution": _mean(resolution)},
        "model": context["model"],
    }


async def report_context(session: AsyncSession, *, start: datetime, end: datetime) -> dict:
    """Parte do relatório que depende dos dados de clima e do modelo (donos: este backend).

    O serviço Java de operação (services/ops-java) busca isto em /api/v1/ops/report/context e
    junta com os indicadores de ocorrências, que passam a ser dele.
    """

    rain: dict[str, dict] = {}
    rows = (await session.execute(
        select(HourlyObservation.region_code, func.sum(HourlyObservation.precipitation_mm), func.count(HourlyObservation.id))
        .where(HourlyObservation.observed_at > start, HourlyObservation.observed_at <= end)
        .group_by(HourlyObservation.region_code)
    )).all()
    for code, total, count in rows:
        rain[code] = {"total_mm": round(float(total or 0.0), 1), "hours": int(count), "source": "observações horárias (ERA5/Open-Meteo)"}
    if not rain:
        # sem série horária: máximo da chuva/h das leituras × horas cobertas (estimativa grosseira)
        rows = (await session.execute(
            select(WeatherReading.region_code, func.avg(WeatherReading.rain_mm), func.count(WeatherReading.id))
            .where(WeatherReading.recorded_at > start).group_by(WeatherReading.region_code)
        )).all()
        for code, avg, count in rows:
            rain[code] = {"total_mm": round(float(avg or 0.0) * hours, 1), "hours": None,
                          "source": "estimativa: média das leituras × horas (sem série horária)"}

    logs = (await session.scalars(select(NowcastLog).where(NowcastLog.as_of > start))).all()
    tp = fp = fn = tn = 0
    evaluated = 0
    for log in logs:
        window_end = _utc(log.as_of) + timedelta(hours=log.horizon_hours)
        if window_end > end:
            continue  # ainda não dá para saber se choveu
        observed = await session.scalar(
            select(func.sum(HourlyObservation.precipitation_mm)).where(
                HourlyObservation.region_code == log.region_code,
                HourlyObservation.observed_at > _utc(log.as_of),
                HourlyObservation.observed_at <= window_end,
            )
        )
        if observed is None:
            continue
        evaluated += 1
        event = observed >= log.heavy_rain_mm
        tp += log.alert and event
        fp += log.alert and not event
        fn += (not log.alert) and event
        tn += (not log.alert) and not event
    model = {
        "evaluated": evaluated, "true_positive": tp, "false_positive": fp, "false_negative": fn, "true_negative": tn,
        "precision": round(tp / (tp + fp), 3) if tp + fp else None,
        "recall": round(tp / (tp + fn), 3) if tp + fn else None,
        "note": None if evaluated else "Sem previsões do modelo verificáveis nesta janela (registro começa com esta versão).",
    }
    return {"start": start, "end": end, "rain": rain, "model": model}


def validate_kind(kind: str) -> str:
    if kind not in TEAM_KINDS:
        raise ConflictError(f"Tipo de equipe inválido: {kind}.")
    return kind
