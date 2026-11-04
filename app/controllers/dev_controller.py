"""Rota de desenvolvimento: recebe erros do navegador (ex.: Safari do Simulador iOS).

Só existe de verdade com DEV_CLIENT_LOG=true (desligado por padrão). As mensagens vão
para a saída do servidor e para logs/client.log, onde o Claude Code consegue lê-las.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.core.config import get_settings

router = APIRouter(prefix="/dev", tags=["Desenvolvimento"], include_in_schema=False)
LOG_FILE = Path(__file__).resolve().parent.parent.parent / "logs" / "client.log"


class ClientLog(BaseModel):
    level: str = Field(default="error", max_length=10)
    message: str = Field(max_length=4000)
    source: str = Field(default="", max_length=300)
    url: str = Field(default="", max_length=300)


@router.post("/client-log", status_code=204, response_class=Response)
async def client_log(entry: ClientLog, request: Request) -> Response:
    if not get_settings().dev_client_log:
        raise HTTPException(status_code=404)
    ua = request.headers.get("user-agent", "")[:120]
    line = (f"{datetime.now(tz=timezone.utc).isoformat(timespec='seconds')} [{entry.level.upper()}] "
            f"{entry.message} | {entry.source} | {entry.url} | {ua}")
    print(f"[client] {line}", flush=True)
    LOG_FILE.parent.mkdir(exist_ok=True)
    with LOG_FILE.open("a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return Response(status_code=204)
