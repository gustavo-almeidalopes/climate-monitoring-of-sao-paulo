/*
 * Interpretação compartilhada dos dados: veredito, tendência, idade, previsão e
 * empate entre regiões. Mapa, lista, popups e veredito usam estas funções para
 * dizer a mesma coisa da mesma forma.
 */
import { LEVELS, levelOf, sortByDanger } from "./risk.js";
import { fmt1 } from "./util.js";

const HOUR = 3_600_000;

export function floorHour(ms) {
    const d = new Date(ms);
    d.setMinutes(0, 0, 0);
    return d.getTime();
}

/** "3 min atrás", "agora", "2 h atrás". */
export function agoText(ms, now = Date.now()) {
    if (!ms) return "";
    const min = Math.round((now - ms) / 60000);
    if (min < 1) return "agora";
    if (min < 60) return `${min} min atrás`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h atrás`;
    return `${Math.round(h / 24)} d atrás`;
}

/** "há 40 min", "há 2 h". */
export function durationText(ms, now = Date.now()) {
    const min = Math.max(1, Math.round((now - ms) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const rest = min % 60;
    return rest >= 10 && h < 6 ? `${h} h ${rest} min` : `${h} h`;
}

/**
 * Tendência da chuva para exibição: { symbol, word, text, direction }.
 * Usa a tendência calculada no servidor (últimas 6 h); sem ela, compara com a leitura anterior.
 */
export function trendInfo(region, now = Date.now()) {
    const t = region.trend && region.trend.rain;
    if (t && t.direction === "up") {
        return { direction: "up", symbol: "▲", word: "subindo",
            text: `subindo${t.since ? ` há ${durationText(t.since, now)}` : ""} (+${fmt1(Math.abs(t.delta))} mm/h)` };
    }
    if (t && t.direction === "down") {
        return { direction: "down", symbol: "▼", word: "caindo",
            text: `caindo${t.since ? ` há ${durationText(t.since, now)}` : ""} (−${fmt1(Math.abs(t.delta))} mm/h)` };
    }
    if (!t && typeof region.prevRain === "number" && typeof region.rain === "number" && region.rain !== region.prevRain) {
        const up = region.rain > region.prevRain;
        return { direction: up ? "up" : "down", symbol: up ? "▲" : "▼", word: up ? "subindo" : "caindo",
            text: `${up ? "subindo" : "caindo"} desde a leitura anterior` };
    }
    if (!t && region.prevRain === undefined) return { direction: "unknown", symbol: "•", word: "", text: "sem histórico recente" };
    return { direction: "flat", symbol: "→", word: "estável", text: "estável nas últimas horas" };
}

/** Primeira hora prevista nas próximas `hours` com nível ≥ Alto: { hoursAhead, danger, point } ou null. */
export function forecastConcern(region, thresholds, now = Date.now(), hours = 3) {
    const limit = now + hours * HOUR;
    for (const p of region.series || []) {
        if (p.kind !== "forecast" || p.t <= now - HOUR / 2 || p.t > limit) continue;
        const danger = levelOf(p, thresholds);
        if (danger.rank >= LEVELS.high.rank) {
            return { hoursAhead: Math.max(1, Math.ceil((p.t - now) / HOUR - 0.05)), danger, point: p };
        }
    }
    return null;
}

/** Valores de uma região numa hora da linha do tempo (offset em horas a partir de agora). */
export function regionAtOffset(region, offset, now = Date.now()) {
    if (!offset) return { ...region, kind: "observed", atTime: region.recordedAt };
    const target = floorHour(now) + offset * HOUR;
    let best = null;
    for (const p of region.series || []) {
        const d = Math.abs(p.t - target);
        if (d <= HOUR / 2 && (!best || d < Math.abs(best.t - target))) best = p;
    }
    if (!best) return null;
    return { ...region, rain: best.rain, risk: best.risk, riskSource: best.riskSource, kind: best.kind, atTime: best.t };
}

/** Regiões no pior nível e se elas estão praticamente empatadas (mesmo ponto de grade). */
export function worstGroup(regions, thresholds) {
    const sorted = sortByDanger(regions, thresholds);
    if (!sorted.length) return null;
    const top = sorted[0].danger;
    const group = sorted.filter(x => x.danger.rank === top.rank).map(x => x.region);
    const rains = group.map(r => r.rain ?? 0);
    const tied = group.length > 1 && Math.max(...rains) - Math.min(...rains) < 0.5;
    return { danger: top, regions: group, tied, all: group.length === regions.length, sorted };
}

/** "na próxima hora" / "nas próximas 2 h". */
export function withinText(hours) {
    return hours <= 1 ? "na próxima hora" : `nas próximas ${hours} h`;
}

export function placeText(group) {
    if (group.all) return group.regions.length > 1 ? "toda a Zona Norte monitorada" : group.regions[0].short;
    const names = group.regions.map(r => r.short);
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

/** Probabilidade do modelo em texto honesto, com a qualidade medida do modelo. */
export function nowcastText(nowcast, model) {
    if (!nowcast || nowcast.probability == null) return null;
    const pct = Math.round(nowcast.probability * 100);
    const shown = pct < 1 ? "< 1%" : `${pct}%`;
    const horizon = nowcast.horizonHours || 3;
    const mm = nowcast.heavyRainMm || 10;
    return {
        headline: `${shown} de chance de chuva forte (≥ ${fmt1(mm)} mm em ${horizon} h)`,
        expected: nowcast.expectedMm != null ? `${fmt1(nowcast.expectedMm)} mm esperados nas próximas ${horizon} h` : null,
        alert: nowcast.alert,
        quality: modelQualityText(model),
    };
}

export function modelQualityText(model) {
    if (!model || !model.available) return "Modelo indisponível no servidor.";
    const parts = [];
    if (model.precision != null) parts.push(`acerta ${Math.round(model.precision * 100)}% dos alertas que emite`);
    if (model.recall != null) parts.push(`detecta ${Math.round(model.recall * 100)}% dos eventos`);
    const weak = model.brier_skill_vs_climatology != null && model.brier_skill_vs_climatology <= 0;
    return `Modelo experimental: ${parts.join(" e ") || "qualidade não informada"} no período de teste`
        + (weak ? "; ainda não supera a média histórica (climatologia)." : ".");
}

/**
 * Veredito: uma frase que um usuário novo entende em 3 segundos.
 * { level, title, detail[], tone } — tone: "sample" | "calm" | "watch" | "danger".
 */
export function buildVerdict(state, thresholds) {
    const regions = Object.values(state.regions);
    if (!regions.length) return { level: null, tone: "calm", title: "Carregando dados…", detail: [] };
    if (state.source === "sample") {
        return { level: null, tone: "sample", title: "Sem dados reais agora — não use este painel para decisões.",
            detail: ["Os números abaixo são exemplos enquanto o servidor não responde."] };
    }
    const now = state.now;
    const group = worstGroup(regions, thresholds);
    const lead = group.regions[0];
    const where = placeText(group);
    const detail = [];
    const age = agoText(state.updatedAt, now);
    if (age) detail.push(`Dado de ${age}`);

    const concerns = regions
        .map(r => ({ r, c: forecastConcern(r, thresholds, now) }))
        .filter(x => x.c)
        .sort((a, b) => b.c.danger.rank - a.c.danger.rank || a.c.hoursAhead - b.c.hoursAhead);
    const concern = concerns[0];
    const nowcastAlert = regions.find(r => r.nowcast && r.nowcast.alert);

    let title;
    let tone;
    if (group.danger.rank >= LEVELS.high.rank) {
        tone = "danger";
        const tr = trendInfo(lead, now);
        let cause = group.danger.reason === "chuva observada na última hora"
            ? `chuva de ${fmt1(lead.rain)} mm/h${tr.direction === "up" ? ", " + tr.text : ""}`
            : "chuva acumulada e previsão do modelo";
        if (concern && concern.c.danger.rank > group.danger.rank) {
            cause = `pode chegar a ${concern.c.danger.label.toUpperCase()} ${withinText(concern.c.hoursAhead)}`;
        } else if (concern && concern.c.danger.rank === group.danger.rank && tr.direction !== "up") {
            cause = `chuva forte prevista ${withinText(concern.c.hoursAhead)}`;
        }
        title = `Risco ${group.danger.label.toUpperCase()} em ${where} — ${cause}`;
    } else if (concern) {
        tone = "watch";
        const names = concerns.filter(x => x.c.danger.rank === concern.c.danger.rank).map(x => x.r);
        const place = names.length === regions.length ? "toda a Zona Norte monitorada" : names.map(r => r.short).join(", ");
        title = `Atenção: chuva forte prevista em ${place} ${withinText(concern.c.hoursAhead)}`;
    } else if (group.danger.rank === LEVELS.medium.rank) {
        tone = "watch";
        title = `Risco MÉDIO em ${where} — chuva de ${fmt1(lead.rain)} mm/h`;
    } else {
        tone = "calm";
        title = "Sem risco de alagamento agora na Zona Norte monitorada";
    }

    const tr = trendInfo(lead, now);
    if (tone !== "calm" && tr.direction !== "unknown") detail.push(`Chuva ${tr.text}`);
    if (nowcastAlert && tone !== "danger") detail.push(`Modelo sinaliza chance de chuva forte em ${nowcastAlert.short}`);
    if (group.tied && group.regions.length > 1) {
        detail.push("As regiões compartilham o mesmo ponto da grade meteorológica — valores quase iguais");
    }
    return { level: group.danger, tone, title, detail, lead, group };
}
