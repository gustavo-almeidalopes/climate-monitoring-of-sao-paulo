/* Cliente HTTP do backend ClimaSP. A URL vem de config.js (window.CLIMASP_API_BASE). */

function defaultBase() {
    const { hostname, origin } = window.location;
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    return local ? "http://localhost:8000" : origin;
}

export const API_BASE = String(window.CLIMASP_API_BASE || defaultBase()).replace(/\/$/, "");

async function request(path, { method = "GET", timeout = 12000 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const resp = await fetch(API_BASE + path, { method, cache: "no-store", signal: controller.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} em ${path}`);
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}

export const api = {
    thresholds: () => request("/api/v1/weather/thresholds"),
    current: () => request("/api/v1/weather/current"),
    overview: () => request("/api/v1/weather/overview"),
    news: () => request("/api/v1/news/?limit=40&hours=72&min_relevance=1"),
    scrapeNews: () => request("/api/v1/news/scrape", { method: "POST", timeout: 60000 }),
};
