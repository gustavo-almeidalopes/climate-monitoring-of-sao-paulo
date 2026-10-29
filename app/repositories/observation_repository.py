from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ml.dataset import OBSERVATION_COLUMNS, HourlyRecord
from app.models.hourly_observation import HourlyObservation

if TYPE_CHECKING:
    import pandas as pd

_BATCH = 500


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _insert_for(session: AsyncSession):
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return insert


class ObservationRepository:
    """Persistência da série horária real usada pelo ML (upsert idempotente por região+hora)."""

    async def upsert_many(self, session: AsyncSession, records: Iterable[HourlyRecord]) -> int:
        insert = _insert_for(session)
        rows = [
            {
                "region_code": r.region_code,
                "observed_at": _as_utc(r.observed_at),
                "source": r.source,
                **{col: r.values.get(col) for col in OBSERVATION_COLUMNS},
            }
            for r in records
        ]
        for start in range(0, len(rows), _BATCH):
            chunk = rows[start : start + _BATCH]
            stmt = insert(HourlyObservation).values(chunk)
            stmt = stmt.on_conflict_do_update(
                index_elements=["region_code", "observed_at"],
                set_={col: getattr(stmt.excluded, col) for col in [*OBSERVATION_COLUMNS, "source"]},
            )
            await session.execute(stmt)
        await session.commit()
        return len(rows)

    async def latest_by_source(
        self, session: AsyncSession, region_code: str, source: str | None = None
    ) -> datetime | None:
        conditions = [HourlyObservation.region_code == region_code]
        if source:
            conditions.append(HourlyObservation.source == source)
        value = await session.scalar(select(func.max(HourlyObservation.observed_at)).where(and_(*conditions)))
        return _as_utc(value) if value else None

    async def earliest(self, session: AsyncSession, region_code: str) -> datetime | None:
        value = await session.scalar(
            select(func.min(HourlyObservation.observed_at)).where(HourlyObservation.region_code == region_code)
        )
        return _as_utc(value) if value else None

    async def coverage(self, session: AsyncSession) -> list[dict]:
        rows = await session.execute(
            select(
                HourlyObservation.region_code,
                HourlyObservation.source,
                func.count(HourlyObservation.id),
                func.min(HourlyObservation.observed_at),
                func.max(HourlyObservation.observed_at),
            )
            .group_by(HourlyObservation.region_code, HourlyObservation.source)
            .order_by(HourlyObservation.region_code, HourlyObservation.source)
        )
        return [
            {
                "region": code,
                "source": source,
                "hours": int(count),
                "start": _as_utc(start) if start else None,
                "end": _as_utc(end) if end else None,
            }
            for code, source, count, start, end in rows.all()
        ]

    async def count(self, session: AsyncSession) -> int:
        return int(await session.scalar(select(func.count(HourlyObservation.id))) or 0)

    async def load_frame(
        self,
        session: AsyncSession,
        *,
        region_code: str | None = None,
        since: datetime | None = None,
    ) -> "pd.DataFrame":
        import pandas as pd

        stmt = select(
            HourlyObservation.region_code,
            HourlyObservation.observed_at,
            HourlyObservation.source,
            *[getattr(HourlyObservation, col) for col in OBSERVATION_COLUMNS],
        )
        if region_code:
            stmt = stmt.where(HourlyObservation.region_code == region_code.upper())
        if since:
            stmt = stmt.where(HourlyObservation.observed_at >= since)
        stmt = stmt.order_by(HourlyObservation.region_code, HourlyObservation.observed_at)

        result = await session.execute(stmt)
        frame = pd.DataFrame(
            result.all(), columns=["region_code", "observed_at", "source", *OBSERVATION_COLUMNS]
        )
        if not frame.empty:
            frame["observed_at"] = pd.to_datetime(frame["observed_at"], utc=True)
        return frame
