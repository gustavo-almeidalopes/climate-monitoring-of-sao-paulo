from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_news_repository
from app.db.session import get_db
from app.repositories.news_repository import NewsRepository
from app.services.news_scraper_service import scrape_all_sources
from app.views.news_views import NewsArticleOut, NewsResponse, ScrapeResponse

router = APIRouter(prefix="/news", tags=["Notícias"])


@router.get("/", response_model=NewsResponse)
async def list_news(
    limit: int = Query(default=20, ge=1, le=100),
    hours: int = Query(default=48, ge=1, le=168, description="Horas retroativas para busca"),
    min_relevance: float = Query(default=1.0, ge=0.0, le=10.0),
    db: AsyncSession = Depends(get_db),
    news_repo: NewsRepository = Depends(get_news_repository),
) -> NewsResponse:
    articles = await news_repo.list_recent(db, limit=limit, hours=hours, min_relevance=min_relevance)
    last_scraped = await news_repo.last_scraped_at(db)

    return NewsResponse(
        total=len(articles),
        last_scraped_at=last_scraped,
        articles=[
            NewsArticleOut(
                id=a.id,
                title=a.title,
                summary=a.summary,
                url=a.url,
                source=a.source,
                published_at=a.published_at,
                scraped_at=a.scraped_at,
                relevance_score=a.relevance_score,
                matched_keywords=a.matched_keywords.split(",") if a.matched_keywords else [],
            )
            for a in articles
        ],
    )


@router.post("/scrape", response_model=ScrapeResponse)
async def scrape_news(
    db: AsyncSession = Depends(get_db),
    news_repo: NewsRepository = Depends(get_news_repository),
) -> ScrapeResponse:
    """Dispara raspagem manual das fontes de notícias RSS (G1 SP, Folha, UOL)."""
    articles, checked = await scrape_all_sources()
    new_count = await news_repo.save_many(db, articles)
    return ScrapeResponse(
        message=f"{new_count} artigo(s) novo(s) salvo(s) de {len(checked)} fonte(s).",
        new_articles=new_count,
        sources_checked=checked,
    )
