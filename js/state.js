/* Estado global da aplicação: uma única fonte da verdade para todos os módulos. */
import { createStore } from "./store.js";

export const DEFAULT_THRESHOLDS = Object.freeze({ red: 40, orange: 20, yellow: 5, riskCuts: { medium: 25, high: 50, critical: 75 } });

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
    /** true quando o backend serviu /overview (séries, tendência e nowcast disponíveis). */
    hasSeries: false,
    /** Resumo e qualidade do modelo de ML ({ available, precision, recall, ... }). */
    model: { available: false },
    /** O que mudou desde a leitura anterior: { ST: { rain: true, level: true } }. */
    changes: {},
    changesAt: 0,

    /** Região aberta no painel de detalhe (id) ou null. */
    selectedRegion: null,
    /** Deslocamento da linha do tempo do mapa, em horas (0 = agora; −24…+48). */
    timeOffset: 0,

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

    /** Aba do painel lateral: "regions" | "ops". */
    sideTab: "regions",
    /** Operação (Fase 3): perfil logado ("operador" | "gestor" | null) e dados carregados. */
    opsRole: null,
    opsTeams: [],
    opsIncidents: [],
    opsReport: null,
    opsError: null,
    /** Ponto escolhido para despacho e as equipes mais rápidas calculadas para ele. */
    opsTarget: null,
    opsCandidates: null,

    /** Relógio para textos relativos ("há 3 min"), atualizado periodicamente. */
    now: Date.now(),
});

export function effectiveThresholds(state) {
    return state.operator && state.customThresholds ? state.customThresholds : state.officialThresholds;
}

export function thresholdsDiffer(a, b) {
    return !!a && !!b && (a.red !== b.red || a.orange !== b.orange || a.yellow !== b.yellow);
}
