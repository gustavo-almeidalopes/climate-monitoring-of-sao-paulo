"""Perfis de acesso (Fase 3).

- cidadão: sem credencial — vê alertas, mapa e previsão (rotas públicas existentes);
- operador: equipes, despacho, ocorrências e limiares — `Authorization: Bearer <OPERATOR_TOKEN>`;
- gestor: indicadores e relatório pós-evento (leitura) — `Authorization: Bearer <MANAGER_TOKEN>`.

Os tokens vêm de variáveis de ambiente. Sem eles configurados, as rotas de operação
respondem 503 explicando o que falta — não existe token padrão embutido no código.
É um controle simples, adequado a um piloto; para produção, troque por login individual
(OIDC/gov.br) com registro por pessoa.
"""
from __future__ import annotations

import hmac

from fastapi import Depends, Header, HTTPException

from app.core.config import get_settings

ROLE_RANK = {"gestor": 1, "operador": 2}


def _role_for(token: str) -> str | None:
    settings = get_settings()
    if settings.operator_token and hmac.compare_digest(token, settings.operator_token):
        return "operador"
    if settings.manager_token and hmac.compare_digest(token, settings.manager_token):
        return "gestor"
    return None


def current_role(authorization: str | None = Header(default=None)) -> str:
    settings = get_settings()
    if not settings.operator_token and not settings.manager_token:
        raise HTTPException(
            status_code=503,
            detail="Operação não configurada: defina OPERATOR_TOKEN e MANAGER_TOKEN no servidor.",
        )
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Credencial ausente.", headers={"WWW-Authenticate": "Bearer"})
    role = _role_for(authorization[7:].strip())
    if role is None:
        raise HTTPException(status_code=401, detail="Credencial inválida.", headers={"WWW-Authenticate": "Bearer"})
    return role


def require(role: str):
    """Exige `role` ou um perfil acima (operador ⊃ gestor para leitura de indicadores)."""

    def dependency(actual: str = Depends(current_role)) -> str:
        if ROLE_RANK.get(actual, 0) < ROLE_RANK[role]:
            raise HTTPException(status_code=403, detail=f"Ação restrita ao perfil {role}.")
        return actual

    return dependency
