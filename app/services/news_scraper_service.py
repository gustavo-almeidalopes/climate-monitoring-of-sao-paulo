from __future__ import annotations

import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx

from app.models.news_article import NewsArticle

# Fontes RSS confiáveis sobre clima / alagamentos em SP
RSS_SOURCES: list[dict] = [
    {
        "id": "g1_sp",
        "name": "G1 São Paulo",
        "url": "https://g1.globo.com/dynamo/sao-paulo/rss2.xml",
    },
    {
        "id": "folha_cotidiano",
        "name": "Folha de SP - Cotidiano",
        "url": "https://feeds.folha.uol.com.br/cotidiano/rss091.xml",
    },
    {
        "id": "uol_noticias",
        "name": "UOL Notícias",
        "url": "https://rss.uol.com.br/feed/noticias.xml",
    },
]

# Palavras-chave de relevância para triagem de notícias de alagamento
KEYWORDS_HIGH: list[str] = [
    "alagamento", "alagada", "alagadas", "alagados",
    "enchente", "enchentes", "inundação", "inundações",
    "transbordamento", "transbordou",
]
KEYWORDS_MED: list[str] = [
    "chuva intensa", "chuva forte", "temporal", "tempestade",
    "alerta de chuva", "defesa civil", "emergência climática",
    "rio overflowed", "deslizamento",
]
KEYWORDS_LOW: list[str] = [
    "chuva", "precipitação", "nível do rio", "represa",
    "são paulo", "clima", "meteorologia", "sirene",
]

_RE_STRIP = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return _RE_STRIP.sub("", text or "").strip()


def _score_text(text: str) -> tuple[float, list[str]]:
    lower = text.lower()
    score = 0.0
    matched: list[str] = []
    for kw in KEYWORDS_HIGH:
        if kw in lower:
            score += 3.0
            matched.append(kw)
    for kw in KEYWORDS_MED:
        if kw in lower:
            score += 1.5
            matched.append(kw)
    for kw in KEYWORDS_LOW:
        if kw in lower:
            score += 0.5
            matched.append(kw)
    return min(score, 10.0), matched


def _parse_rss_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    try:
        return parsedate_to_datetime(date_str).replace(tzinfo=timezone.utc)
    except Exception:
        return None


async def _fetch_rss_xml(url: str, timeout: float = 15.0) -> str:
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        resp = await client.get(url, headers={"User-Agent": "ClimaSP-Bot/1.0 (+monitor)"})
        resp.raise_for_status()
        return resp.text


def _parse_rss_items(xml_text: str, source_id: str, source_name: str) -> list[NewsArticle]:
    """Parseia RSS/Atom via regex simples — sem dependência extra de feedparser."""
    articles: list[NewsArticle] = []

    item_blocks = re.findall(r"<item>(.*?)</item>", xml_text, re.DOTALL)
    for block in item_blocks:
        title_m   = re.search(r"<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", block, re.DOTALL)
        link_m    = re.search(r"<link[^>]*>(.*?)</link>", block, re.DOTALL)
        desc_m    = re.search(r"<description[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</description>", block, re.DOTALL)
        date_m    = re.search(r"<pubDate[^>]*>(.*?)</pubDate>", block, re.DOTALL)

        title = _strip_html((title_m.group(1) if title_m else "").strip())
        url   = (link_m.group(1) if link_m else "").strip()
        desc  = _strip_html((desc_m.group(1) if desc_m else "").strip())
        pub   = _parse_rss_date((date_m.group(1) if date_m else "").strip())

        if not title or not url:
            continue

        full_text = f"{title} {desc}"
        score, matched = _score_text(full_text)
        if score < 0.5:
            continue

        articles.append(
            NewsArticle(
                title=title[:500],
                summary=desc[:2000] if desc else None,
                url=url[:1000],
                source=source_name,
                published_at=pub,
                scraped_at=datetime.now(tz=timezone.utc),
                relevance_score=score,
                matched_keywords=",".join(matched[:10]),
            )
        )

    return articles


async def scrape_all_sources() -> tuple[list[NewsArticle], list[str]]:
    """Raspa todas as fontes RSS e retorna (artigos filtrados, ids de fontes verificadas)."""
    all_articles: list[NewsArticle] = []
    checked_sources: list[str] = []

    for source in RSS_SOURCES:
        try:
            xml = await _fetch_rss_xml(source["url"])
            articles = _parse_rss_items(xml, source["id"], source["name"])
            all_articles.extend(articles)
            checked_sources.append(source["id"])
        except Exception as exc:
            print(f"[NewsScraper] Falha em {source['id']}: {exc}")

    return all_articles, checked_sources
