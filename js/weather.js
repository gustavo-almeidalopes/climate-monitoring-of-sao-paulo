/* Carga e atualização dos dados climáticos (limiares + leitura atual). */
import { api } from "./api.js";
import { REGION_META, sampleRegions } from "./regions.js";
import { store } from "./state.js";
import { $, num } from "./util.js";

export const REFRESH_INTERVAL_S = 5 * 60;
let secondsLeft = REFRESH_INTERVAL_S;
let inFlight = null;

export async function loadThresholds() {
    try {
        const t = await api.thresholds();
        const red = num(t.red_mm_h), orange = num(t.orange_mm_h), yellow = num(t.yellow_mm_h);
        if (red != null && orange != null && yellow != null) {
            store.set({ officialThresholds: { red, orange, yellow } });
        }
    } catch (err) {
        console.warn("Limiares indisponíveis; usando os padrões CEMADEN.", err);
    }
}

function parseRegions(payload, previous) {
    const regions = {};
    for (const [code, r] of Object.entries(payload?.regions || {})) {
        const meta = REGION_META[code];
        if (!meta || !r) continue;
        const prev = previous[code];
        const recordedAt = Date.parse(r.recorded_at);
        regions[code] = {
            ...meta,
            name: meta.name,
            temp: num(r.temp),
            hum: num(r.hum) == null ? null : Math.round(num(r.hum)),
            rain: num(r.rain),
            wind: num(r.wind),
            risk: num(r.risk) == null ? null : Math.round(num(r.risk)),
            recordedAt: Number.isFinite(recordedAt) ? recordedAt : null,
            prevRisk: prev ? prev.risk : undefined,
            prevRain: prev ? prev.rain : undefined,
            isSample: false,
        };
    }
    return regions;
}

/**
 * Busca /weather/current. Em caso de falha:
 *  - se já havia dado real, mantém a última leitura e marca a conexão como perdida;
 *  - senão, exibe os dados de exemplo (source = "sample").
 */
export function loadWeather() {
    if (inFlight) return inFlight;
    store.set({ connection: "loading" });
    inFlight = (async () => {
        try {
            const payload = await api.current();
            const before = store.get();
            const regions = parseRegions(payload, before.source === "live" ? before.regions : {});
            if (!Object.keys(regions).length) throw new Error("Resposta sem regiões conhecidas");
            const updatedAt = Date.parse(payload.updated_at);
            store.set({
                connection: "online",
                source: "live",
                regions,
                updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
                now: Date.now(),
            });
            return true;
        } catch (err) {
            console.warn("Servidor do ClimaSP indisponível:", err);
            if (store.get().source === "live") store.set({ connection: "offline", now: Date.now() });
            else store.set({ connection: "offline", source: "sample", regions: sampleRegions(), updatedAt: null });
            return false;
        } finally {
            secondsLeft = REFRESH_INTERVAL_S;
            inFlight = null;
        }
    })();
    return inFlight;
}

function fmtCountdown(s) {
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
