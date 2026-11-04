/*
 * Regiões monitoradas e DADOS DE EXEMPLO.
 *
 * REGION_META espelha app/core/constants.py (nomes com acentuação para exibição).
 * SAMPLE_VALUES são valores ilustrativos, NÃO são medições: só aparecem quando o
 * servidor não responde e sempre marcados como "exemplo" na interface.
 */

export const REGION_META = Object.freeze({
    CV: { id: "CV", name: "Subprefeitura Casa Verde/Cachoeirinha", short: "Casa Verde", lat: -23.49, lng: -46.66 },
    ST: { id: "ST", name: "Subprefeitura Santana/Tucuruvi", short: "Santana", lat: -23.485, lng: -46.615 },
    JT: { id: "JT", name: "Subprefeitura Jaçanã/Tremembé", short: "Jaçanã", lat: -23.445, lng: -46.585 },
    MG: { id: "MG", name: "Subprefeitura Vila Maria/Vila Guilherme", short: "Vila Maria", lat: -23.51, lng: -46.585 },
});

/** Distrito (nome normalizado) → subprefeitura. */
export const DISTRICT_TO_REGION = Object.freeze({
    "CASA VERDE": "CV", CACHOEIRINHA: "CV", LIMAO: "CV",
    SANTANA: "ST", TUCURUVI: "ST", MANDAQUI: "ST",
    JACANA: "JT", TREMEMBE: "JT",
    "VILA MARIA": "MG", "VILA GUILHERME": "MG", "VILA MEDEIROS": "MG",
});

const SAMPLE_VALUES = Object.freeze({
    CV: { temp: 24.5, hum: 80, rain: 5.7, wind: 12, risk: 48 },
    ST: { temp: 25.1, hum: 82, rain: 12.4, wind: 16, risk: 65 },
    JT: { temp: 23.8, hum: 88, rain: 3.1, wind: 18, risk: 32 },
    MG: { temp: 25.4, hum: 86, rain: 0.5, wind: 11, risk: 18 },
});

export function sampleRegions() {
    const out = {};
    for (const [id, meta] of Object.entries(REGION_META)) {
        out[id] = {
            ...meta, ...SAMPLE_VALUES[id], riskSource: "sample", recordedAt: null, series: [], recent: [],
            trend: null, nowcast: null, prevRisk: undefined, prevRain: undefined, isSample: true,
        };
    }
    return out;
}
