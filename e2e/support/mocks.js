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

/* ------------------------------------------------------------------ Fase 3: operação */

const OPS_TEAMS = [
    { id: 1, code: "EX-01", name: "[EXEMPLO] Bombeiros 1", kind: "bombeiros", lat: -23.5038, lng: -46.628 },
    { id: 2, code: "EX-02", name: "[EXEMPLO] Defesa Civil Santana", kind: "defesa_civil", lat: -23.482, lng: -46.615 },
    { id: 3, code: "EX-03", name: "[EXEMPLO] SAMU 1", kind: "samu", lat: -23.47, lng: -46.66 },
    { id: 4, code: "EX-04", name: "[EXEMPLO] CET 1", kind: "cet", lat: -23.52, lng: -46.58 },
    { id: 5, code: "EX-05", name: "[EXEMPLO] Defesa Civil Jaçanã", kind: "defesa_civil", lat: -23.442, lng: -46.585 },
];

const kmBetween = (a, b) => {
    const r = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
};

/**
 * API de operação simulada (estado em memória) + OSRM simulado.
 * Credenciais: "op-teste" é operador, "gestor-teste" é gestor; com `configured: false`, 503.
 */
export async function mockOps(page, { configured = true, osrmDown = false } = {}) {
    const now = () => new Date().toISOString();
    const db = {
        teams: OPS_TEAMS.map(t => ({ ...t, status: "disponivel", base_lat: t.lat, base_lng: t.lng, base_name: "base de teste",
            base_source: "teste", is_example: true, updated_at: now() })),
        incidents: [],
        calls: [],
    };
    const roleOf = req => {
        const h = req.headers().authorization || "";
        return h === "Bearer op-teste" ? "operador" : h === "Bearer gestor-teste" ? "gestor" : null;
    };
    await page.route(/\/api\/v1\/ops\//, route => {
        const req = route.request();
        const url = new URL(req.url());
        const path = url.pathname.replace(/^.*\/api\/v1\/ops/, "");
        db.calls.push(`${req.method()} ${path}`);
        const json = (body, status = 200) => route.fulfill({ status, body: JSON.stringify(body), contentType: "application/json" });
        if (!configured) return json({ detail: "Operação não configurada: defina OPERATOR_TOKEN e MANAGER_TOKEN no servidor." }, 503);
        const role = roleOf(req);
        if (!role) return json({ detail: "Credencial inválida." }, 401);
        const body = req.postData() ? JSON.parse(req.postData()) : {};
        const write = req.method() !== "GET";
        if (write && role !== "operador") return json({ detail: "Ação restrita ao perfil operador." }, 403);
        let m;
        if (path === "/me") return json({ role });
        if (path === "/teams") return json(db.teams);
        if ((m = path.match(/^\/teams\/(\d+)$/))) {
            const t = db.teams.find(x => x.id === Number(m[1]));
            Object.assign(t, Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)), { updated_at: now() });
            return json(t);
        }
        if (path.startsWith("/incidents") && req.method() === "GET") return json([...db.incidents].reverse());
        if (path === "/incidents") {
            const inc = { id: db.incidents.length + 1, kind: body.kind, description: body.description, address: body.address,
                lat: body.lat, lng: body.lng, region: "ST", status: "aberta", team_id: null, eta_minutes: null, opened_at: now(),
                assigned_at: null, arrived_at: null, resolved_at: null, is_example: false,
                timeline: [{ at: now(), kind: "aberta", team_id: null, note: body.description, actor_role: role }] };
            db.incidents.push(inc);
            return json(inc, 201);
        }
        if ((m = path.match(/^\/incidents\/(\d+)\/(assign|arrive|resolve)$/))) {
            const inc = db.incidents.find(i => i.id === Number(m[1]));
            const team = () => db.teams.find(t => t.id === inc.team_id);
            if (m[2] === "assign") {
                const t = db.teams.find(x => x.id === body.team_id);
                if (t.status !== "disponivel") return json({ detail: `${t.name} não está disponível.` }, 409);
                t.status = "em_deslocamento"; inc.team_id = t.id; inc.status = "despachada"; inc.assigned_at = now(); inc.eta_minutes = body.eta_minutes;
            } else if (m[2] === "arrive") {
                team().status = "em_ocorrencia"; inc.status = "no_local"; inc.arrived_at = now();
            } else {
                if (team()) team().status = "disponivel";
                inc.status = "resolvida"; inc.resolved_at = now();
            }
            inc.timeline.push({ at: now(), kind: m[2], team_id: inc.team_id, note: "", actor_role: role });
            return json(inc);
        }
        if (path.startsWith("/report")) {
            return json({ start: now(), end: now(), hours: 24, rain: { ST: { total_mm: 31.5, hours: 24, source: "teste" } },
                incidents: { total: db.incidents.length, by_status: { resolvida: db.incidents.filter(i => i.status === "resolvida").length },
                    mean_minutes_to_dispatch: 2.5, mean_minutes_to_arrival: 9.1, mean_minutes_to_resolution: 40.2 },
                model: { evaluated: 12, true_positive: 1, false_positive: 3, false_negative: 1, true_negative: 7, precision: 0.25, recall: 0.5, note: null } });
        }
        return json({ detail: "não encontrado" }, 404);
    });

    // OSRM: tempo proporcional à distância (30 km/h); a rota mais rápida corta em linha reta,
    // a alternativa desvia para o norte.
    await page.route("https://router.project-osrm.org/**", route => {
        db.calls.push(`OSRM ${new URL(route.request().url()).pathname.split("/")[1]}`);
        if (osrmDown) return route.fulfill({ status: 503, body: "{}" });
        const url = new URL(route.request().url());
        const coords = decodeURIComponent(url.pathname.split("/").pop()).split(";").map(c => { const [lng, lat] = c.split(",").map(Number); return { lat, lng }; });
        const json = body => route.fulfill({ status: 200, body: JSON.stringify(body), contentType: "application/json" });
        if (url.pathname.startsWith("/table/")) {
            const dest = coords[coords.length - 1];
            return json({ code: "Ok", durations: coords.slice(0, -1).map(s => [(kmBetween(s, dest) / 30) * 3600]) });
        }
        const [a, b] = coords;
        const line = [[a.lng, a.lat], [b.lng, b.lat]];
        const mid = { lat: Math.max(a.lat, b.lat) + 0.03, lng: (a.lng + b.lng) / 2 };
        const km = kmBetween(a, b);
        return json({ code: "Ok", routes: [
            { duration: (km / 30) * 3600, distance: km * 1000, geometry: { coordinates: line } },
            { duration: (km / 24) * 3600, distance: km * 1300, geometry: { coordinates: [[a.lng, a.lat], [mid.lng, mid.lat], [b.lng, b.lat]] } },
        ] });
    });
    return db;
}
