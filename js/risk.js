/*
 * Critério ÚNICO de nível de perigo — mapa, popups, lista, alertas, veredito e busca.
 * Espelha app/core/risk_levels.py (o servidor envia os mesmos limiares em /thresholds):
 *
 *   nível = o pior entre
 *     (a) a chuva observada na última hora vs. limiares CEMADEN/Defesa Civil (5/20/40 mm/h);
 *     (b) o índice de risco 0–100 vs. cortes 25/50/75 — só quando vem do modelo
 *         (risk_source === "ml"), que já combina chuva acumulada e a previsão de chuva forte.
 *
 * O índice heurístico (servidor sem modelo) mistura umidade/vento/temperatura e nunca sobe o nível.
 */

export const LEVELS = {
    low: { level: "low", rank: 0, label: "Baixo", symbol: "✓", color: "#2F8A4C" },
    medium: { level: "medium", rank: 1, label: "Médio", symbol: "→", color: "#CFA22A" },
    high: { level: "high", rank: 2, label: "Alto", symbol: "▲", color: "#E8590C" },
    critical: { level: "critical", rank: 3, label: "Crítico", symbol: "⚠", color: "#BE1554" },
};
const ORDER = ["low", "medium", "high", "critical"];

export const DEFAULT_RISK_CUTS = Object.freeze({ medium: 25, high: 50, critical: 75 });

/** Estilo neutro das zonas quando os dados são de exemplo (sem conexão). */
export const SAMPLE_COLOR = "#8C8C8C";

export function levelFromRain(rain, thresholds) {
    const r = rain == null ? 0 : rain;
    if (r >= thresholds.red) return LEVELS.critical;
    if (r >= thresholds.orange) return LEVELS.high;
    if (r >= thresholds.yellow) return LEVELS.medium;
    return LEVELS.low;
}

export function levelFromRisk(risk, cuts = DEFAULT_RISK_CUTS) {
    const v = risk == null ? 0 : risk;
    if (v >= cuts.critical) return LEVELS.critical;
    if (v >= cuts.high) return LEVELS.high;
    if (v >= cuts.medium) return LEVELS.medium;
    return LEVELS.low;
}

/**
 * Nível pelo critério único. Aceita uma região ou um ponto da série ({ rain, risk, risk_source }).
 * Devolve o objeto de LEVELS acrescido de `reason` (texto curto para a interface).
 */
export function levelOf(point, thresholds) {
    const byRain = levelFromRain(point.rain, thresholds);
    const source = point.riskSource ?? point.risk_source;
    const byRisk = source === "ml" ? levelFromRisk(point.risk, thresholds.riskCuts || DEFAULT_RISK_CUTS) : LEVELS.low;
    if (byRisk.rank > byRain.rank) return { ...byRisk, reason: "chuva acumulada e previsão do modelo" };
    if (byRain.rank > 0) return { ...byRain, reason: "chuva observada na última hora" };
    return { ...LEVELS.low, reason: "sem chuva significativa" };
}

/** Compatibilidade: nível só pela chuva (usado onde não há índice, ex.: limiares do operador). */
export const dangerFromRain = levelFromRain;

export function levelRank(level) {
    return ORDER.indexOf(level);
}

/** Ordena regiões da mais grave para a menos grave (nível, depois chuva, depois risco). */
export function sortByDanger(regions, thresholds) {
    return regions
        .map(region => ({ region, danger: levelOf(region, thresholds) }))
        .sort((a, b) => b.danger.rank - a.danger.rank
            || (b.region.rain ?? 0) - (a.region.rain ?? 0)
            || (b.region.risk ?? 0) - (a.region.risk ?? 0));
}

export function worstRegion(regions, thresholds) {
    return sortByDanger(regions, thresholds)[0] || null;
}
