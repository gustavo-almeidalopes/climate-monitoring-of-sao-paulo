/* Conteúdo HTML dos popups. Todo texto dinâmico passa por escapeHtml. */
import { icon, weatherIconName } from "./icons.js";
import { dangerFromRain } from "./risk.js";
import { escapeHtml, fmt0, fmt1, fmtClock, timeAgo } from "./util.js";

function riskTrend(region) {
    if (region.isSample) return "";
    if (typeof region.prevRisk !== "number" || typeof region.risk !== "number") {
        return '<div class="pu-risk-trend">• primeira leitura desta sessão</div>';
    }
    const delta = region.risk - region.prevRisk;
    if (!delta) return '<div class="pu-risk-trend">→ estável desde a leitura anterior</div>';
    const rising = delta > 0;
    const n = Math.abs(delta);
    return `<div class="pu-risk-trend ${rising ? "rising" : "falling"}">${rising ? "▲" : "▼"} ` +
        `${rising ? "subiu" : "caiu"} ${n} ponto${n === 1 ? "" : "s"} desde a leitura anterior</div>`;
}

export function levelBadge(danger, sample) {
    if (sample) return '<div class="pu-badge sample">Exemplo</div>';
    return `<div class="pu-badge ${danger.level}">${danger.label}</div>`;
}

function dataAge(region, now) {
    if (region.isSample) {
        return '<div class="pu-age sample">Dados de exemplo — sem conexão com o servidor. Não use para decisões.</div>';
    }
    if (!region.recordedAt) return "";
    return `<div class="pu-age">Leitura de ${fmtClock(region.recordedAt)} (${timeAgo(region.recordedAt, now)})</div>`;
}

function cell(iconName, label, value, unit) {
    return `<div class="pu-cell">${icon(iconName, "pu-cell-icon")}<div class="pu-cell-l">${label}</div>` +
        `<div class="pu-cell-v">${value}<span class="pu-cell-u"> ${unit}</span></div></div>`;
}

export function regionPopup(region, thresholds, { now = Date.now(), approximate = false } = {}) {
    const d = dangerFromRain(region.rain, thresholds);
    const sample = !!region.isSample;
    const risk = region.risk == null ? 0 : Math.max(0, Math.min(100, region.risk));
    const barColor = sample ? "var(--text-tertiary)" : d.color;
    return `<div class="pu ${sample ? "is-sample" : ""}">
        <div class="pu-top">
            <div class="pu-weather-icon lvl-${sample ? "sample" : d.level}">${icon(weatherIconName(d.level, region.wind))}</div>
            <div class="pu-info"><div class="pu-name">${escapeHtml(region.short)}</div><div class="pu-sub">${escapeHtml(region.name)}</div></div>
            ${levelBadge(d, sample)}
        </div>
        <div class="pu-grid">
            ${cell("thermometer", "Temperatura", fmt1(region.temp), "°C")}
            ${cell("droplet", "Umidade", fmt0(region.hum), "%")}
            ${cell("cloud-rain", "Chuva atual", fmt1(region.rain), "mm/h")}
            ${cell("wind", "Vento", fmt0(region.wind), "km/h")}
        </div>
        <div class="pu-risk">
            <div class="pu-risk-h">
                <span class="pu-risk-l tooltip-trigger" tabindex="0" data-tip="Índice de 0 a 100 calculado no servidor: combina a chuva já observada com a probabilidade de chuva forte nas próximas horas prevista pelo modelo.">Índice de risco</span>
                <span class="pu-risk-v">${region.risk == null ? "—" : region.risk}<span class="pu-risk-max">/100</span></span>
            </div>
            <div class="pu-bar-t" role="presentation"><div class="pu-bar-f" style="width:${risk}%;background:${barColor}"></div></div>
            ${riskTrend(region)}
        </div>
        ${dataAge(region, now)}
        ${approximate ? '<div class="pu-age">Contorno aproximado — os limites oficiais dos distritos não carregaram.</div>' : ""}
    </div>`;
}

/**
 * Popup do endereço buscado: nome e endereço do Nominatim (texto escapado) +
 * nível de perigo da subprefeitura em que o ponto está.
 * @param {{ title: string, address: string, place: object|null, region: object|null, thresholds: object, now: number }} p
 */
export function searchPopup({ title, address, place, region, thresholds, now }) {
    let body;
    if (place && place.inside && region) {
        const d = dangerFromRain(region.rain, thresholds);
        const how = place.exact
            ? `Distrito ${escapeHtml(place.district)} · ${escapeHtml(region.name)}`
            : `${escapeHtml(region.short)} é a região monitorada mais próxima (${fmt1(place.distanceKm)} km do centro)`;
        body = `<div class="ps-risk ${region.isSample ? "is-sample" : ""}">
            <div class="ps-row">${levelBadge(d, region.isSample)}
                <span class="ps-val">${fmt1(region.rain)} mm/h · risco ${region.risk ?? "—"}/100</span></div>
            <div class="ps-where">${how}</div>
            <div class="ps-note">Nível da subprefeitura, não uma medição exata deste endereço.</div>
            ${dataAge(region, now)}
        </div>`;
    } else if (place && region) {
        body = `<div class="ps-risk ps-outside">
            <div class="ps-where"><strong>Fora da área monitorada.</strong> O ClimaSP cobre só 4 subprefeituras da Zona Norte.</div>
            <div class="ps-note">Região monitorada mais próxima: ${escapeHtml(region.short)} (${fmt1(place.distanceKm)} km).</div>
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
