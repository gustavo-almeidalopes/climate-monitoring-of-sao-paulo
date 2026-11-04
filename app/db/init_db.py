from __future__ import annotations

from sqlalchemy import inspect, text

from app.db.base import Base
from app.db.session import engine
from app.models import (  # noqa: F401
    forecast_reading,
    hourly_observation,
    model_run,
    news_article,
    ops,
    region,
    weather_reading,
)


# Colunas acrescentadas depois da criação das tabelas: (tabela, coluna, tipo SQL).
# create_all não altera tabelas existentes, então elas são adicionadas aqui (sempre anuláveis).
_ADDITIVE_COLUMNS = (
    ("weather_readings", "risk_source", "VARCHAR(16)"),
    ("forecast_readings", "risk_source", "VARCHAR(16)"),
)


def _add_missing_columns(sync_conn) -> None:
    inspector = inspect(sync_conn)
    for table, column, sql_type in _ADDITIVE_COLUMNS:
        if not inspector.has_table(table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if column not in existing:
            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {sql_type}"))


async def init_db() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
