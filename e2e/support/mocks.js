// Simulações de rede compartilhadas pelos testes.
// Nada aqui é dado real: os valores de clima são cenários de teste.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { CACHE_FILE } from "./global-setup.js";

const require = createRequire(import.meta.url);
const LEAFLET_DIST = path.dirname(require.resolve("leaflet/dist/leaflet.js"));

// PNG 1×1 transparente — substitui os tiles dos mapas base.
const BLANK_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
);

export const REGION_META = {
    CV: { name: "Subprefeitura Casa Verde/Cachoeirinha", short: "Casa Verde", lat: -23.49, lng: -46.66 },
    ST: { name: "Subprefeitura Santana/Tucuruvi", short: "Santana", lat: -23.485, lng: -46.615 },
    JT: { name: "Subprefeitura Jacana/Tremembe", short: "Jaçanã", lat: -23.445, lng: -46.585 },
    MG: { name: "Subprefeitura Vila Maria/Guilherme", short: "Vila Maria", lat: -23.51, lng: -46.585 },
};

/** Monta uma resposta de /api/v1/weather/current a partir de {CV: {rain, risk}, ...}. */
export function currentPayload(values = {}, updatedAt = new Date()) {
    const regions = {};
    for (const [id, meta] of Object.entries(REGION_META)) {
        const v = values[id] || {};
        regions[id] = {
            id,
            name: meta.name,
            short: meta.short,
            color: "#000000",
            lat: meta.lat,
            lng: meta.lng,
            temp: v.temp ?? 22.0,
            hum: v.hum ?? 70,
            rain: v.rain ?? 0.0,
            wind: v.wind ?? 8.0,
            risk: v.risk ?? 10,
            source: "teste",
            recorded_at: updatedAt.toISOString(),
        };
    }
    return { updated_at: updatedAt.toISOString(), regions };
}

export const THRESHOLDS = {
    yellow_mm_h: 5,
    orange_mm_h: 20,
    red_mm_h: 40,
    levels: [],
    risk_cuts: { medium: 25, high: 50, critical: 75 },
};

export const MODEL = {
    available: true, version: "teste", horizon_hours: 3, heavy_rain_mm: 10,
    precision: 0.07, recall: 0.066, roc_auc: 0.85, pr_auc: 0.025,
    brier_skill_vs_climatology: -0.003, persistence_pr_auc: 0.028, test_positive_rate: 0.005,
};

/**
 * Resposta de /api/v1/weather/overview. `values` como em currentPayload, mais por região:
 *  - riskSource ("ml" | "heuristic"), forecast: (h) => mm/h na hora +h, history: (h) => mm/h na hora −h,
 *  - trend: { direction, minutesAgo, delta }, nowcast: { probability, alert, expected }.
 */
export function overviewPayload(values = {}, { updatedAt = new Date(), model = MODEL } = {}) {
    const base = currentPayload(values, updatedAt);
    const hour = new Date(); hour.setMinutes(0, 0, 0); // séries em horas cheias do relógio atual, como no servidor
    const regions = {};
    for (const [id, r] of Object.entries(base.regions)) {
        const v = values[id] || {};
        const src = v.riskSource || "ml";
        const series = [];
        for (let h = 24; h >= 0; h--) {
            const rain = h === 0 ? r.rain : (v.history ? v.history(h) : Math.max(0, r.rain - h * 0.2));
            series.push({ t: new Date(hour.getTime() - h * 3600e3).toISOString(), kind: "observed", rain, risk: v.risk ?? 10, risk_source: src });
        }
        for (let h = 1; h <= 48; h++) {
            const rain = v.forecast ? v.forecast(h) : 0.2;
            series.push({ t: new Date(hour.getTime() + h * 3600e3).toISOString(), kind: "forecast", rain, risk: Math.min(100, Math.round(rain * 2.5)), risk_source: src });
        }
        const recent = [];
        for (let m = 360; m >= 0; m -= 30) {
            recent.push({ t: new Date(updatedAt.getTime() - m * 60e3).toISOString(), rain: Math.max(0, r.rain - (m / 60) * 1.5), risk: r.risk });
        }
        const tr = v.trend || { direction: r.rain > 1 ? "up" : "flat", minutesAgo: 40, delta: Math.min(r.rain, 8) };
        regions[id] = {
            ...r,
            risk_source: src,
            series,
            recent,
            trend: {
                rain: { direction: tr.direction, since: tr.direction === "flat" ? null : new Date(Date.now() - tr.minutesAgo * 60e3).toISOString(), delta: tr.delta },
                risk: { direction: "flat", since: null, delta: 0 },
            },
            nowcast: model.available ? {
                as_of: updatedAt.toISOString(), horizon_hours: 3, heavy_rain_mm: 10,
                heavy_rain_probability: v.nowcast?.probability ?? 0.012,
                heavy_rain_alert: v.nowcast?.alert ?? false,
                expected_rain_next_mm: v.nowcast?.expected ?? 0.4,
            } : null,
        };
    }
    return { generated_at: updatedAt.toISOString(), updated_at: base.updated_at, thresholds: THRESHOLDS, model, regions };
}

// Polígonos sintéticos (retângulos) — usados só quando o GeoJSON real não
// pôde ser baixado no global-setup. Não representam os limites reais.
function syntheticDistricts() {
    const box = (name, lat, lng, d = 0.012) => ({
        type: "Feature",
        properties: { ds_nome: name },
        geometry: {
            type: "Polygon",
            coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
        },
    });
    return {
        type: "FeatureCollection",
        features: [
            box("CASA VERDE", -23.49, -46.66),
            box("SANTANA", -23.485, -46.615),
            box("JACANA", -23.445, -46.585),
            box("VILA MARIA", -23.51, -46.585),
        ],
    };
}

function districtsBody() {
    if (fs.existsSync(CACHE_FILE)) return fs.readFileSync(CACHE_FILE);
    return JSON.stringify(syntheticDistricts());
}

/**
 * Instala as simulações de rede numa página.
 * @param {import('@playwright/test').Page} page
 * @param {{ current?: object|(() => object), apiDown?: boolean|(() => boolean), nominatim?: object[], news?: object }} opts
 */
export async function mockNetwork(page, opts = {}) {
    const state = {
        current: opts.current ?? null,
        overview: opts.overview ?? null,
        legacy: opts.legacy ?? false,
        apiDown: opts.apiDown ?? false,
        nominatim: opts.nominatim ?? [],
        news: opts.news ?? { articles: [], total: 0, last_scraped_at: null },
        requests: [],
    };

    // Leaflet servido a partir do pacote npm oficial (mesmo conteúdo do unpkg).
    await page.route("https://unpkg.com/leaflet@1.9.4/dist/**", route => {
        const file = new URL(route.request().url()).pathname.split("/dist/")[1];
        const full = path.join(LEAFLET_DIST, file);
        if (!fs.existsSync(full)) return route.fulfill({ status: 404 });
        const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "application/javascript" : "image/png";
        return route.fulfill({ status: 200, body: fs.readFileSync(full), contentType: type, headers: { "access-control-allow-origin": "*" } });
    });
    // Tiles dos mapas base.
    for (const host of ["**/*.basemaps.cartocdn.com/**", "**/server.arcgisonline.com/**", "**/*.tile.openstreetmap.org/**"]) {
        await page.route(host, route => route.fulfill({ status: 200, body: BLANK_PNG, contentType: "image/png" }));
    }
    await page.route("https://fonts.googleapis.com/**", route => route.fulfill({ status: 200, body: "", contentType: "text/css" }));
    await page.route("https://fonts.gstatic.com/**", route => route.abort());
    await page.route("https://raw.githubusercontent.com/codigourbano/**", route =>
        route.fulfill({ status: 200, body: districtsBody(), contentType: "application/json" }));
    await page.route("https://api.rainviewer.com/**", route => route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ host: "https://tilecache.rainviewer.com", radar: { past: [{ time: Math.floor(Date.now() / 1000) - 600, path: "/v2/radar/teste" }] } }),
    }));
    await page.route("https://tilecache.rainviewer.com/**", route => route.fulfill({ status: 200, body: BLANK_PNG, contentType: "image/png" }));
    await page.route("https://nominatim.openstreetmap.org/**", route => {
        state.requests.push(route.request().url());
        return route.fulfill({ status: 200, body: JSON.stringify(state.nominatim), contentType: "application/json" });
    });

    await page.route(/\/api\/v1\//, route => {
        const url = new URL(route.request().url());
        state.requests.push(url.pathname);
        const down = typeof state.apiDown === "function" ? state.apiDown() : state.apiDown;
        if (down) return route.fulfill({ status: 503, body: "{}", contentType: "application/json" });
        const json = body => route.fulfill({ status: 200, body: JSON.stringify(body), contentType: "application/json" });
        if (url.pathname.endsWith("/weather/thresholds")) return json(THRESHOLDS);
        const resolve = v => (typeof v === "function" ? v() : v);
        if (url.pathname.endsWith("/weather/overview")) {
            if (state.legacy) return route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
            if (state.overview) return json(resolve(state.overview));
            // derivado de `current` quando o teste só define a leitura atual
            const cur = resolve(state.current) || currentPayload();
            const values = {};
            for (const [id, r] of Object.entries(cur.regions)) values[id] = { rain: r.rain, risk: r.risk, temp: r.temp, hum: r.hum, wind: r.wind };
            return json(overviewPayload(values, { updatedAt: new Date(cur.updated_at) }));
        }
        if (url.pathname.endsWith("/weather/current")) {
            return json(resolve(state.current) || currentPayload());
        }
        if (url.pathname.includes("/news")) return json(state.news);
        return route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
    });

    return state;
}
