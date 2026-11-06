/*
 * Service worker do ClimaSP (PWA).
 *
 * - App shell em cache: o painel abre mesmo sem rede (instalado na tela inicial ou não).
 * - Dados de clima: rede primeiro; sem rede, a ÚLTIMA LEITURA REAL guardada, marcada com o
 *   cabeçalho X-ClimaSP-Offline para o painel avisar "Conexão perdida" — nunca "Ao vivo".
 * - Notificações (Web Push): alertas de nível Alto/Crítico enviados pelo servidor.
 * Operação (/api/v1/ops), alertas e notícias nunca vêm do cache.
 * A lista de módulos é conferida por tests/test_frontend_static.py.
 */
const VERSION = "climasp-v1";
const SHELL = [
    "./",
    "index.html",
    "styles.css",
    "config.js",
    "manifest.webmanifest",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/apple-touch-icon.png",
    "js/alerts.js",
    "js/api.js",
    "js/charts.js",
    "js/cluster.js",
    "js/devlog.js",
    "js/geolocate.js",
    "js/icons.js",
    "js/insights.js",
    "js/layers.js",
    "js/main.js",
    "js/map.js",
    "js/news.js",
    "js/operator.js",
    "js/ops.js",
    "js/popup.js",
    "js/pwa.js",
    "js/regionlist.js",
    "js/regions.js",
    "js/risk.js",
    "js/routing.js",
    "js/search.js",
    "js/state.js",
    "js/status.js",
    "js/store.js",
    "js/theme.js",
    "js/timeline.js",
    "js/tooltips.js",
    "js/types.js",
    "js/ui.js",
    "js/util.js",
    "js/weather.js",
    "data/geo/hex-zona-norte.geojson",
];
const LEAFLET = /^https:\/\/unpkg\.com\/leaflet@1\.9\.4\/dist\//;
const WEATHER_API = /\/api\/v1\/weather\/(overview|current|thresholds)$/;
const NETWORK_TIMEOUT_MS = 8000;

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        const cache = await caches.open(VERSION);
        // um arquivo que falhe não impede a instalação (os demais seguem em cache)
        await Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: "reload" })).catch(() => {})));
        await self.skipWaiting();
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
        await self.clients.claim();
    })());
});

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("timeout")), ms);
        promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
}

/** Clima: rede primeiro; sem rede, a última resposta real, marcada como offline. */
async function weather(request) {
    const cache = await caches.open(VERSION);
    try {
        const response = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
        if (response.ok) {
            await cache.put(request.url, response.clone());
            return response;
        }
        if (response.status < 500) return response;
        throw new Error(`HTTP ${response.status}`); // servidor fora do ar: cai na última leitura real
    } catch (err) {
        const cached = await cache.match(request.url);
        if (!cached) throw err;
        const headers = new Headers(cached.headers);
        headers.set("X-ClimaSP-Offline", "1");
        return new Response(await cached.blob(), { status: 200, headers });
    }
}

/** Arquivos do painel: responde do cache na hora e atualiza em segundo plano. */
async function staleWhileRevalidate(request, event) {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    const update = fetch(request).then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
    }).catch(() => cached);
    if (cached) { event.waitUntil(update); return cached; }
    return update;
}

/** Navegação: rede primeiro (versão nova do painel); sem rede, o index.html em cache. */
async function navigation(request) {
    try {
        return await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    } catch (err) {
        const cache = await caches.open(VERSION);
        return (await cache.match("index.html")) || (await cache.match("./")) || Response.error();
    }
}

self.addEventListener("fetch", event => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (request.mode === "navigate") { event.respondWith(navigation(request)); return; }
    if (WEATHER_API.test(url.pathname)) { event.respondWith(weather(request)); return; }
    if (LEAFLET.test(request.url)) { event.respondWith(staleWhileRevalidate(request, event)); return; }
    if (url.origin === self.location.origin && !url.pathname.startsWith("/api/")) {
        event.respondWith(staleWhileRevalidate(request, event));
    }
});

/* ------------------------------------------------------------------ notificações */

self.addEventListener("push", event => {
    let data = {};
    try { data = event.data ? event.data.json() : {}; } catch (err) { data = { body: event.data && event.data.text() }; }
    const title = data.title || "ClimaSP: alerta de alagamento";
    event.waitUntil(self.registration.showNotification(title, {
        body: data.body || "",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
        tag: `climasp-${data.region || "geral"}`,
        renotify: true,
        requireInteraction: data.level === "critical",
        lang: "pt-BR",
        data: { url: data.url || "./" },
    }));
});

self.addEventListener("notificationclick", event => {
    event.notification.close();
    const target = new URL(event.notification.data && event.notification.data.url || "./", self.registration.scope).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of windows) {
            if (client.url.startsWith(self.registration.scope)) { await client.focus(); client.navigate(target); return; }
        }
        await self.clients.openWindow(target);
    })());
});
