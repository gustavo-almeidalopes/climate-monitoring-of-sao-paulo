/*
 * Critério único de nível de perigo usado por mapa, popups, cartões, busca e alertas.
 *
 * Fase 0: o nível vem da chuva observada (mm/h) contra os limiares CEMADEN /
 * Defesa Civil servidos por /api/v1/weather/thresholds. A Fase 1 troca este
 * critério pelo risco combinado (observado + modelo) — basta mudar este arquivo.
 */

export const LEVELS = {
    low: { level: "low", rank: 0, label: "Baixo", symbol: "✓", color: "#87A96B" },
    medium: { level: "medium", rank: 1, label: "Médio", symbol: "→", color: "#F4D06F" },
    high: { level: "high", rank: 2, label: "Alto", symbol: "▲", color: "#F9A66C" },
    critical: { level: "critical", rank: 3, label: "Crítico", symbol: "⚠", color: "#FF6F61" },
};

/** Estilo neutro das zonas quando os dados são de exemplo (sem conexão). */
export const SAMPLE_COLOR = "#8C8C8C";

export function dangerFromRain(rain, thresholds) {
    const r = rain == null ? 0 : rain;
    if (r >= thresholds.red) return LEVELS.critical;
    if (r >= thresholds.orange) return LEVELS.high;
    if (r >= thresholds.yellow) return LEVELS.medium;
    return LEVELS.low;
}

export function levelRank(level) {
    return level && LEVELS[level] ? LEVELS[level].rank : -1;
}

/** Região mais grave: maior nível; empate decidido pela chuva e depois pelo índice de risco. */
export function worstRegion(regions, thresholds) {
    let worst = null;
    for (const region of regions) {
        const d = dangerFromRain(region.rain, thresholds);
        if (!worst) { worst = { region, danger: d }; continue; }
        const a = [d.rank, region.rain ?? 0, region.risk ?? 0];
        const b = [worst.danger.rank, worst.region.rain ?? 0, worst.region.risk ?? 0];
        if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) {
            worst = { region, danger: d };
        }
    }
    return worst;
}
