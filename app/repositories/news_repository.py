from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.news_article import NewsArticle


class NewsRepository:
    """Camada de acesso a dados para artigos de notícias sobre alagamentos (Model no MVC)."""

    async def save_article(self, session: AsyncSession, article: NewsArticle) -> bool:
        """Persiste um artigo. Retorna True se inserido, False se já existia (URL duplicada)."""
        existing = await session.scalar(
            select(NewsArticle).where(NewsArticle.url == article.url)
        )
        if existing:
            return False
        session.add(article)
        await session.commit()
        return True

    async def save_many(
        self, session: AsyncSession, articles: list[NewsArticle]
    ) -> int:
        """Persiste múltiplos artigos. Retorna quantidade de novos inseridos."""
        inserted = 0
        for article in articles:
            if await self.save_article(session, article):
                inserted += 1
        return inserted

    async def list_recent(
        self,
        session: AsyncSession,
        limit: int = 20,
        hours: int = 48,
        min_relevance: float = 0.0,
    ) -> list[NewsArticle]:
        since = datetime.now(tz=timezone.utc) - timedelta(hours=hours)
        rows = await session.scalars(
            select(NewsArticle)
            .where(
                NewsArticle.scraped_at >= since,
                NewsArticle.relevance_score >= min_relevance,
            )
            .order_by(desc(NewsArticle.relevance_score), desc(NewsArticle.scraped_at))
            .limit(limit)
        )
        return list(rows)

    async def last_scraped_at(self, session: AsyncSession) -> datetime | None:
        result = await session.scalar(
            select(NewsArticle.scraped_at).order_by(desc(NewsArticle.scraped_at)).limit(1)
        )
        return result

    async def prune_old(self, session: AsyncSession, days: int = 7) -> int:
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=days)
        result = await session.execute(
            delete(NewsArticle).where(NewsArticle.scraped_at < cutoff)
        )
        await session.commit()
        return int(result.rowcount or 0)
