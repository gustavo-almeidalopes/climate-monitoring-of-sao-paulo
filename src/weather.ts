/*
 * Carga e atualização dos dados climáticos.
 *
 * Usa /api/v1/weather/overview (leitura atual + série −24 h…+48 h + tendência + nowcast,
 * numa chamada). Se o backend for mais antigo e não tiver esse endpoint, cai para
 * /weather/current (sem séries). Sem servidor: dados de exemplo, claramente marcados.
 */
import { api, isOfflineCopy } from "./api.js";
import { REGION_META, sampleRegions } from "./regions.js";
import { DEFAULT_RISK_CUTS, levelOf } from "./risk.js";
import { effectiveThresholds, store } from "./state.js";
import { $, num } from "./util.js";
import type { AppState, ModelSummary, Region, RegionId, Regions, Thresholds, Trend } from "./types.js";

export const REFRESH_INTERVAL_S = 5 * 60;
let secondsLeft = REFRESH_INTERVAL_S;
let inFlight: Promise<boolean> | null = null;

function parseThresholds(t: any): Thresholds | null {
    const red = num(t?.red_mm_h), orange = num(t?.orange_mm_h), yellow = num(t?.yellow_mm_h);
    if (red == null || orange == null || yellow == null) return null;
    const cuts = t.risk_cuts || {};
    return {
        red, orange, yellow,
        riskCuts: {
            medium: num(cuts.medium) ?? DEFAULT_RISK_CUTS.medium,
            high: num(cuts.high) ?? DEFAULT_RISK_CUTS.high,
            critical: num(cuts.critical) ?? DEFAULT_RISK_CUTS.critical,
        },
    };
}

export async function loadThresholds() {
    try {
        const parsed = parseThresholds(await api.thresholds());
        if (parsed) store.set({ officialThresholds: parsed });
    } catch (err) {
        console.warn("Limiares indisponíveis; usando os padrões CEMADEN.", err);
    }
}

const time = (v: unknown): number | null => { const ms = Date.parse(String(v)); return Number.isFinite(ms) ? ms : null; };

function parseTrend(t: any): Trend | null {
    if (!t) return null;
    return { direction: t.direction || "flat", since: time(t.since), delta: num(t.delta) ?? 0 };
}

function parseRegion(code: RegionId, r: any, prev: Region | undefined): Region {
    const meta = REGION_META[code];
    return {
        ...meta,
        temp: num(r.temp),
        hum: num(r.hum) == null ? null : Math.round(num(r.hum) as number),
        rain: num(r.rain),
        wind: num(r.wind),
        risk: num(r.risk) == null ? null : Math.round(num(r.risk) as number),
        riskSource: r.risk_source || "unknown",
        recordedAt: time(r.recorded_at),
        series: Array.isArray(r.series) ? r.series.map((p: any) => ({
            t: time(p.t), kind: p.kind === "forecast" ? "forecast" : "observed",
            rain: num(p.rain), risk: num(p.risk), riskSource: p.risk_source || "unknown",
        })).filter((p: { t: number | null }) => p.t != null) : [],
        recent: Array.isArray(r.recent) ? r.recent.map((p: any) => ({ t: time(p.t), rain: num(p.rain), risk: num(p.risk) }))
            .filter((p: { t: number | null }) => p.t != null) : [],
        trend: r.trend ? { rain: parseTrend(r.trend.rain), risk: parseTrend(r.trend.risk) } : null,
        nowcast: r.nowcast ? {
            asOf: time(r.nowcast.as_of),
            horizonHours: num(r.nowcast.horizon_hours),
            heavyRainMm: num(r.nowcast.heavy_rain_mm),
            probability: num(r.nowcast.heavy_rain_probability),
            alert: !!r.nowcast.heavy_rain_alert,
            expectedMm: num(r.nowcast.expected_rain_next_mm),
        } : null,
        prevRisk: prev ? prev.risk : undefined,
        prevRain: prev ? prev.rain : undefined,
        isSample: false,
    };
}

/** O que mudou desde a leitura anterior, por região — para destacar na interface. */
function diffRegions(prev: Regions, next: Regions, thresholds: Thresholds): AppState["changes"] {
    const changes: AppState["changes"] = {};
    for (const [id, r] of Object.entries(next) as [RegionId, Region][]) {
        const p = prev[id];
        if (!p) continue;
        const c: { rain?: boolean; risk?: boolean; level?: boolean } = {};
        if (p.rain !== r.rain) c.rain = true;
        if (p.risk !== r.risk) c.risk = true;
        if (levelOf(p, thresholds).level !== levelOf(r, thresholds).level) c.level = true;
        if (Object.keys(c).length) changes[id] = c;
    }
    return changes;
}

async function fetchPayload(): Promise<{ kind: "overview" | "current"; data: any }> {
    try {
        return { kind: "overview", data: await api.overview() };
    } catch (err) {
        if (!String((err as Error).message).includes("HTTP 404")) throw err;
        return { kind: "current", data: await api.current() }; // backend sem /overview
    }
}

/**
 * Busca os dados. Em caso de falha:
 *  - se já havia dado real, mantém a última leitura e marca a conexão como perdida;
 *  - senão, exibe os dados de exemplo (source = "sample").
 */
export function loadWeather(): Promise<boolean> {
    if (inFlight) return inFlight;
    store.set({ connection: "loading" });
    inFlight = (async () => {
        try {
            const { kind, data } = await fetchPayload();
            const before = store.get();
            const previous: Regions = before.source === "live" ? before.regions : {};
            const regions: Regions = {};
            for (const [code, r] of Object.entries(data?.regions || {}) as [RegionId, any][]) {
                if (REGION_META[code] && r) regions[code] = parseRegion(code, r, previous[code]);
            }
            if (!Object.keys(regions).length) throw new Error("Resposta sem regiões conhecidas");
            const thresholds = kind === "overview" ? parseThresholds(data.thresholds) : null;
            const patch: Partial<AppState> = {
                // cópia guardada pelo service worker: dado real, mas sem conexão agora
                connection: isOfflineCopy(data) ? "offline" : "online",
                source: "live",
                regions,
                updatedAt: time(data.updated_at) ?? Date.now(),
                hasSeries: kind === "overview",
                model: (kind === "overview" ? data.model || { available: false } : { available: false }) as ModelSummary,
                now: Date.now(),
            };
            if (thresholds) patch.officialThresholds = thresholds;
            patch.changes = diffRegions(previous, regions, effectiveThresholds({ ...before, ...patch }));
            patch.changesAt = Date.now();
            store.set(patch);
            return !isOfflineCopy(data);
        } catch (err) {
            console.warn("Servidor do ClimaSP indisponível:", err);
            if (store.get().source === "live") store.set({ connection: "offline", now: Date.now() });
            else store.set({ connection: "offline", source: "sample", regions: sampleRegions(), updatedAt: null, changes: {} });
            return false;
        } finally {
            secondsLeft = REFRESH_INTERVAL_S;
            inFlight = null;
        }
    })();
    return inFlight;
}

function fmtCountdown(s: number): string {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function initAutoRefresh() {
    const btn = $("#btnRefresh");
    const countdown = $("#refreshCountdown");
    btn.addEventListener("click", () => loadWeather());

    store.subscribe(s => s.connection, connection => {
        const busy = connection === "loading";
        btn.classList.toggle("spinning", busy);
        btn.setAttribute("aria-busy", String(busy));
    });

    setInterval(() => {
        secondsLeft = Math.max(0, secondsLeft - 1);
        countdown.textContent = fmtCountdown(secondsLeft);
        if (secondsLeft <= 0) loadWeather();
    }, 1000);

    // Textos relativos ("dado de há 3 min") andam sozinhos, sem nova requisição.
    setInterval(() => store.set({ now: Date.now() }), 30_000);
}
