/*
 * Tempo de chegada por ruas (OSRM). Chamado direto do navegador, no servidor público de
 * demonstração do OSRM (perfil carro, sem trânsito, uso moderado: só em cliques do operador).
 * Se o serviço não responder, cai para uma ESTIMATIVA em linha reta, sempre rotulada.
 */
import { haversineKm } from "./util.js";
export const OSRM = (window.CLIMASP_OSRM_URL || "https://router.project-osrm.org").replace(/\/$/, "");
const TIMEOUT = 12000;
const FALLBACK_KMH = 25; // velocidade média urbana assumida na estimativa
const DETOUR_FACTOR = 1.4; // ruas não são linha reta
async function getJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
        const resp = await fetch(url, { signal: ctrl.signal });
        if (!resp.ok)
            throw new Error(`OSRM HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.code && data.code !== "Ok")
            throw new Error(`OSRM ${data.code}`);
        return data;
    }
    finally {
        clearTimeout(timer);
    }
}
const coord = p => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;
export function estimateMinutes(from, to) {
    return (haversineKm(from.lat, from.lng, to.lat, to.lng) * DETOUR_FACTOR / FALLBACK_KMH) * 60;
}
/**
 * Minutos de cada origem até o destino. Devolve { minutes: number[], estimated: boolean }.
 */
export async function travelTimes(sources, dest) {
    if (!sources.length)
        return { minutes: [], estimated: false };
    try {
        const coords = [...sources, dest].map(coord).join(";");
        const idx = sources.map((_, i) => i).join(";");
        const data = await getJson(`${OSRM}/table/v1/driving/${coords}?sources=${idx}&destinations=${sources.length}&annotations=duration`);
        const minutes = data.durations.map(row => (row[0] == null ? null : row[0] / 60));
        return { minutes, estimated: false };
    }
    catch (err) {
        console.warn("OSRM indisponível; usando estimativa em linha reta.", err);
        return { minutes: sources.map(s => estimateMinutes(s, dest)), estimated: true };
    }
}
/**
 * Rotas de `from` até `to` (com alternativas). Cada rota: { minutes, km, coords: [[lat, lng], ...] }.
 * Sem OSRM: uma "rota" em linha reta marcada como estimada.
 */
export async function routes(from, to) {
    try {
        const data = await getJson(`${OSRM}/route/v1/driving/${coord(from)};${coord(to)}?alternatives=true&overview=full&geometries=geojson`);
        return data.routes.map(r => ({
            minutes: r.duration / 60,
            km: r.distance / 1000,
            coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
            estimated: false,
        }));
    }
    catch (err) {
        console.warn("OSRM indisponível para rota; linha reta estimada.", err);
        return [{
                minutes: estimateMinutes(from, to),
                km: haversineKm(from.lat, from.lng, to.lat, to.lng),
                coords: [[from.lat, from.lng], [to.lat, to.lng]],
                estimated: true,
            }];
    }
}
/**
 * Escolhe a melhor rota evitando zonas críticas: entre as alternativas, prefere a que não
 * cruza células em nível Crítico desde que não custe mais de 50% de tempo; senão fica com a
 * mais rápida e sinaliza o trecho crítico. `isCritical(lat, lng)` vem do mapa.
 */
export function pickRoute(options, isCritical) {
    const scored = options.map(r => {
        let critical = 0;
        for (let i = 0; i < r.coords.length; i += 3)
            if (isCritical(r.coords[i][0], r.coords[i][1]))
                critical++;
        return { ...r, critical };
    }).sort((a, b) => a.minutes - b.minutes);
    const fastest = scored[0];
    const safe = scored.find(r => r.critical === 0);
    if (fastest.critical === 0)
        return { ...fastest, avoided: false };
    if (safe && safe.minutes <= fastest.minutes * 1.5)
        return { ...safe, avoided: true };
    return { ...fastest, avoided: false };
}
