"""API de operação (Fase 3) — /api/v1/ops/*. Rotas novas; nenhuma rota existente muda."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import current_role, require
from app.db.session import get_db
from app.services import ops_service
from app.services.exceptions import NotFoundError

router = APIRouter(prefix="/ops", tags=["Operação"])


class TeamOut(BaseModel):
    id: int
    code: str
    name: str
    kind: str
    status: str
    lat: float
    lng: float
    base_name: str
    base_source: str
    base_lat: float
    base_lng: float
    is_example: bool
    updated_at: datetime | None


class TeamPatch(BaseModel):
    status: str | None = None
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


class TimelineEvent(BaseModel):
    at: datetime
    kind: str
    team_id: int | None = None
    note: str = ""
    actor_role: str


class IncidentOut(BaseModel):
    id: int
    kind: str
    description: str
    address: str
    lat: float
    lng: float
    region: str | None
    status: str
    team_id: int | None
    eta_minutes: float | None
    opened_at: datetime
    assigned_at: datetime | None
    arrived_at: datetime | None
    resolved_at: datetime | None
    is_example: bool
    timeline: list[TimelineEvent]


class IncidentIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    kind: str = Field(default="alagamento", max_length=30)
    description: str = Field(default="", max_length=500)
    address: str = Field(default="", max_length=200)


class AssignIn(BaseModel):
    team_id: int
    eta_minutes: float | None = Field(default=None, ge=0, le=600)


class ResolveIn(BaseModel):
    note: str = Field(default="", max_length=300)


class MeOut(BaseModel):
    role: str


def _guard(fn):
    async def wrapper(*args, **kwargs):
        try:
            return await fn(*args, **kwargs)
        except NotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ops_service.ConflictError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    return wrapper


@router.get("/me", response_model=MeOut)
async def me(role: str = Depends(current_role)) -> MeOut:
    """Valida a credencial e devolve o perfil (operador ou gestor)."""
    return MeOut(role=role)


@router.get("/teams", response_model=list[TeamOut])
async def teams(db: AsyncSession = Depends(get_db), _: str = Depends(require("gestor"))) -> list[dict]:
    return await ops_service.list_teams(db)


@router.patch("/teams/{team_id}", response_model=TeamOut)
async def patch_team(team_id: int, body: TeamPatch, db: AsyncSession = Depends(get_db),
                     _: str = Depends(require("operador"))) -> dict:
    return await _guard(ops_service.update_team)(db, team_id, status=body.status, lat=body.lat, lng=body.lng)


@router.get("/incidents", response_model=list[IncidentOut])
async def incidents(include_resolved: bool = Query(default=True), limit: int = Query(default=100, ge=1, le=500),
                    db: AsyncSession = Depends(get_db), _: str = Depends(require("gestor"))) -> list[dict]:
    return await ops_service.list_incidents(db, include_resolved=include_resolved, limit=limit)


@router.post("/incidents", response_model=IncidentOut, status_code=201)
async def open_incident(body: IncidentIn, db: AsyncSession = Depends(get_db),
                        role: str = Depends(require("operador"))) -> dict:
    return await ops_service.open_incident(db, lat=body.lat, lng=body.lng, kind=body.kind,
                                           description=body.description, address=body.address, role=role)


@router.post("/incidents/{incident_id}/assign", response_model=IncidentOut)
async def assign(incident_id: int, body: AssignIn, db: AsyncSession = Depends(get_db),
                 role: str = Depends(require("operador"))) -> dict:
    return await _guard(ops_service.assign_team)(db, incident_id, body.team_id, eta_minutes=body.eta_minutes, role=role)


@router.post("/incidents/{incident_id}/arrive", response_model=IncidentOut)
async def arrive(incident_id: int, db: AsyncSession = Depends(get_db), role: str = Depends(require("operador"))) -> dict:
    return await _guard(ops_service.arrive)(db, incident_id, role=role)


@router.post("/incidents/{incident_id}/resolve", response_model=IncidentOut)
async def resolve(incident_id: int, body: ResolveIn, db: AsyncSession = Depends(get_db),
                  role: str = Depends(require("operador"))) -> dict:
    return await _guard(ops_service.resolve)(db, incident_id, note=body.note, role=role)


@router.get("/report/context")
async def report_context(hours: int = Query(default=24, ge=1, le=24 * 30), db: AsyncSession = Depends(get_db),
                         _: str = Depends(require("gestor"))) -> dict:
    """Chuva acumulada e acerto do modelo na janela (sem as ocorrências).

    Usado pelo serviço Java de operação para montar o relatório pós-evento.
    """
    end = ops_service._now()
    return await ops_service.report_context(db, start=end - timedelta(hours=hours), end=end)


@router.get("/report")
async def report(hours: int = Query(default=24, ge=1, le=24 * 30), db: AsyncSession = Depends(get_db),
                 _: str = Depends(require("gestor"))) -> dict:
    """Relatório pós-evento: chuva acumulada, ocorrências, tempos de resposta e acerto do modelo."""
    return await ops_service.report(db, hours=hours)
