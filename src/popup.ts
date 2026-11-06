/* Conteúdo HTML dos popups. Todo texto dinâmico passa por escapeHtml. */
import { icon, weatherIconName } from "./icons.js";
import { agoText, forecastConcern, nowcastText, trendInfo } from "./insights.js";
import { levelOf } from "./risk.js";
import { escapeHtml, fmt0, fmt1, fmtClock, fmtDateTime } from "./util.js";
import type { ModelSummary, Region, RegionAt, Thresholds } from "./types.js";

export function levelBadge(danger, sample) {
    if (sample) return '<div class="pu-badge sample">Exemplo</div>';
    return `<div class="pu-badge ${danger.level}">${danger.label}</div>`;
}

function dataAge(region, now) {
    if (region.isSample) {
        return '<div class="pu-age sample">Dados de exemplo — sem conexão com o servidor. Não use para decisões.</div>';
    }
    if (region.kind === "forecast") return `<div class="pu-age">Previsão para ${fmtDateTime(region.atTime)}</div>`;
    if (region.atTime && region.atTime !== region.recordedAt) return `<div class="pu-age">Observado em ${fmtDateTime(region.atTime)}</div>`;
    if (!region.recordedAt) return "";
    return `<div class="pu-age">Dado de ${agoText(region.recordedAt, now)} (${fmtClock(region.recordedAt)})</div>`;
}

function cell(iconName, label, value, unit) {
    return `<div class="pu-cell">${icon(iconName, "pu-cell-icon")}<div class="pu-cell-l">${label}</div>` +
        `<div class="pu-cell-v">${value}<span class="pu-cell-u"> ${unit}</span></div></div>`;
}

function nextHours(region: Region | RegionAt, thresholds: Thresholds, now: number, model: ModelSummary | null) {
    if (region.isSample || region.kind === "forecast") return "";
    const concern = forecastConcern(region, thresholds, now);
    const n = nowcastText(region.nowcast, model);
    const parts: string[] = [];
    if (concern) parts.push(`<strong class="lvl-${concern.danger.level}">${concern.danger.label}</strong> previsto ${concern.hoursAhead <= 1 ? "na próxima hora" : `em até ${concern.hoursAhead} h`} (${fmt1(concern.point.rain)} mm/h)`);
    if (n) parts.push(`${n.alert ? "<strong>Atenção:</strong> " : ""}${escapeHtml(n.headline)} <span class="pu-note">— modelo experimental</span>`);
    if (!parts.length) return "";
    return `<div class="pu-next"><div class="pu-next-h">Próximas 3 h</div>${parts.map(p => `<div>${p}</div>`).join("")}</div>`;
}

/**
 * Popup de uma região. `region` pode estar deslocada na linha do tempo (kind/atTime).
 */
export interface PopupOptions {
    now?: number;
    approximate?: boolean;
    model?: ModelSummary | null;
}

export function regionPopup(region: Region | RegionAt, thresholds: Thresholds, { now = Date.now(), approximate = false, model = null }: PopupOptions = {}): string {
    const d = levelOf(region, thresholds);
    const sample = !!region.isSample;
    const risk = region.risk == null ? 0 : Math.max(0, Math.min(100, region.risk));
    const barColor = sample ? "var(--text-tertiary)" : d.color;
    const tr = trendInfo(region, now);
    const showTrend = !sample && region.kind !== "forecast" && tr.direction !== "unknown";
    return `<div class="pu ${sample ? "is-sample" : ""}">
        <div class="pu-top">
            <div class="pu-weather-icon lvl-${sample ? "sample" : d.level}">${icon(weatherIconName(d.level, region.wind))}</div>
            <div class="pu-info"><div class="pu-name">${escapeHtml(region.short)}</div><div class="pu-sub">${escapeHtml(region.name)}</div></div>
            ${levelBadge(d, sample)}
        </div>
        ${sample ? "" : `<div class="pu-reason">${region.kind === "forecast" ? "Previsto" : "Nível"} por ${escapeHtml(d.reason)}${showTrend ? ` · chuva ${escapeHtml(tr.text)}` : ""}</div>`}
        <div class="pu-grid">
            ${cell("thermometer", "Temperatura", fmt1(region.temp), "°C")}
            ${cell("droplet", "Umidade", fmt0(region.hum), "%")}
            ${cell("cloud-rain", region.kind === "forecast" ? "Chuva prevista" : "Chuva", fmt1(region.rain), "mm/h")}
            ${cell("wind", "Vento", fmt0(region.wind), "km/h")}
        </div>
        <div class="pu-risk">
            <div class="pu-risk-h">
                <span class="pu-risk-l tooltip-trigger" tabindex="0" data-tip="Índice de 0 a 100 calculado no servidor. Com o modelo: combina chuva acumulada (1 h, 3 h, 24 h) com a probabilidade de chuva forte prevista. Sem o modelo: índice heurístico, que não define o nível.">Índice de risco</span>
                <span class="pu-risk-v">${region.risk == null ? "—" : region.risk}<span class="pu-risk-max">/100</span></span>
            </div>
            <div class="pu-bar-t" role="presentation"><div class="pu-bar-f" style="width:${risk}%;background:${barColor}"></div></div>
            ${!sample && region.riskSource !== "ml" ? '<div class="pu-risk-trend">índice heurístico (sem modelo) — não define o nível</div>' : ""}
        </div>
        ${nextHours(region, thresholds, now, model)}
        ${dataAge(region, now)}
        ${approximate ? '<div class="pu-age">Contorno aproximado — os limites oficiais dos distritos não carregaram.</div>' : ""}
        ${sample ? "" : `<button type="button" class="pu-details" data-action="details" data-region="${region.id}">Ver detalhes e gráficos</button>`}
    </div>`;
}

/**
 * Popup de um ponto (busca ou "minha localização"): nome/endereço (texto escapado) +
 * nível da subprefeitura em que o ponto está, ou a região monitorada mais próxima.
 * @param {{ title: string, address: string, place: object|null, region: object|null, thresholds: object, now: number, model?: object }} p
 */
export function searchPopup({ title, address, place, region, thresholds, now, model }) {
    let body;
    if (place && place.inside && region) {
        const d = levelOf(region, thresholds);
        const tr = trendInfo(region, now);
        const how = place.exact
            ? `Distrito ${escapeHtml(place.district)} · ${escapeHtml(region.name)}`
            : `${escapeHtml(region.short)} é a região monitorada mais próxima (${fmt1(place.distanceKm)} km do centro)`;
        body = `<div class="ps-risk ${region.isSample ? "is-sample" : ""}">
            <div class="ps-row">${levelBadge(d, region.isSample)}
                <span class="ps-val">${fmt1(region.rain)} mm/h · risco ${region.risk ?? "—"}/100</span></div>
            <div class="ps-where">${how}</div>
            ${region.isSample ? "" : `<div class="ps-note">Chuva ${escapeHtml(tr.text)}.</div>`}
            ${nextHours(region, thresholds, now, model)}
            <div class="ps-note">Nível da subprefeitura, não uma medição exata deste endereço.</div>
            ${dataAge(region, now)}
        </div>`;
    } else if (place && region) {
        const d = levelOf(region, thresholds);
        body = `<div class="ps-risk ps-outside">
            <div class="ps-where"><strong>Fora da área monitorada.</strong> O ClimaSP cobre só 4 subprefeituras da Zona Norte.</div>
            <div class="ps-note">Região monitorada mais próxima: ${escapeHtml(region.short)} (${fmt1(place.distanceKm)} km) — nível ${region.isSample ? "de exemplo" : d.label.toLowerCase()}.</div>
        </div>`;
    } else {
        body = '<div class="ps-risk"><div class="ps-note">Dados das regiões ainda não carregados.</div></div>';
    }
    return `<div class="pu ps">
        <div class="ps-head">${icon("map-pin", "ps-pin")}<div><div class="pu-name">${escapeHtml(title)}</div>
        <div class="pu-sub ps-addr">${escapeHtml(address)}</div></div></div>
        ${body}
    </div>`;
}
