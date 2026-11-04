/* Estado global da aplicação: uma única fonte da verdade para todos os módulos. */
import { createStore } from "./store.js";

export const DEFAULT_THRESHOLDS = Object.freeze({ red: 40, orange: 20, yellow: 5 });

export const store = createStore({
    theme: document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",

    /** "loading" | "online" | "offline" — estado da última tentativa de falar com o servidor. */
    connection: "loading",
    /** "none" | "live" | "sample" — de onde vêm os números exibidos. */
    source: "none",
    /** { CV: {id, name, short, lat, lng, temp, hum, rain, wind, risk, recordedAt, prevRisk, prevRain, isSample} } */
    regions: {},
    /** Momento da leitura (servidor), em ms. */
    updatedAt: null,

    officialThresholds: DEFAULT_THRESHOLDS,
    /** Limiares locais do modo operador (só valem com o modo ligado). */
    customThresholds: null,
    operator: false,

    /** "auto" (segue o tema) | "satellite" | "osm" */
    baseLayer: "auto",

    /** Alerta fechado pelo usuário: { level, ids } — reabre se piorar ou se surgir nova região. */
    alertDismissed: null,
    /** Histórico de mudanças de nível: [{ t, id, short, from, to, rain, risk }] (mais novo primeiro). */
    alertHistory: [],
    alertSeenAt: 0,

    /** Relógio para textos relativos ("há 3 min"), atualizado periodicamente. */
    now: Date.now(),
});

export function effectiveThresholds(state) {
    return state.operator && state.customThresholds ? state.customThresholds : state.officialThresholds;
}

export function thresholdsDiffer(a, b) {
    return !!a && !!b && (a.red !== b.red || a.orange !== b.orange || a.yellow !== b.yellow);
}
