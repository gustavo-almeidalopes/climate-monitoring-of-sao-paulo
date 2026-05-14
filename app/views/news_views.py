from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class NewsArticleOut(BaseModel):
    id: int
    title: str
    summary: str | None = None
    url: str
    source: str
    published_at: datetime | None = None
    scraped_at: datetime
    relevance_score: float
    matched_keywords: list[str] = []


class NewsResponse(BaseModel):
    total: int
    articles: list[NewsArticleOut]
    last_scraped_at: datetime | None = None


class ScrapeResponse(BaseModel):
    message: str
    new_articles: int
    sources_checked: list[str]
