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
};

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
        current: opts.current ?? currentPayload(),
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
        if (url.pathname.endsWith("/weather/current")) {
            return json(typeof state.current === "function" ? state.current() : state.current);
        }
        if (url.pathname.includes("/news")) return json(state.news);
        return route.fulfill({ status: 404, body: "{}", contentType: "application/json" });
    });

    return state;
}
