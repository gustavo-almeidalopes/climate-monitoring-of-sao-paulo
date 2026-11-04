/*
 * Painel lateral (desktop) / gaveta (celular): lista de regiões ordenada por nível
 * e painel de detalhe com "Próximas 3 h", gráfico de chuva por hora e linha de risco.
 */
import { dataTable, rainBars, riskLine, sparkline } from "./charts.js";
import { icon } from "./icons.js";
import { agoText, forecastConcern, modelQualityText, nowcastText, trendInfo } from "./insights.js";
import { DEFAULT_RISK_CUTS, levelOf, sortByDanger } from "./risk.js";
import { effectiveThresholds, store } from "./state.js";
import { $, escapeHtml, fmt1, fmtClock } from "./util.js";

let onFocusRegion = () => {};
const STALE_MS = 10 * 60_000;

/** O mapa registra aqui como centralizar uma região (evita dependência circular). */
export function setFocusHandler(fn) { onFocusRegion = fn; }

function badge(d, sample) {
    if (sample) return '<span class="pu-badge sample">Exemplo</span>';
    return `<span class="pu-badge ${d.level}">${d.label}</span>`;
}

function rowHtml(region, d, state) {
    const sample = state.source === "sample";
    const tr = trendInfo(region, state.now);
    const c = state.changes?.[region.id] || {};
    const concern = !sample && forecastConcern(region, effectiveThresholds(state), state.now);
    // A idade do dado já aparece no veredito; na linha, só quando esta região está atrasada.
    const stale = !sample && region.recordedAt && state.updatedAt && state.updatedAt - region.recordedAt >= STALE_MS;
    return `<li>
        <button type="button" class="rl-row lvl-${sample ? "sample" : d.level} ${c.level || c.rain ? "changed" : ""}"
            data-region="${region.id}" aria-describedby="rl-sub-${region.id}">
            <span class="rl-main">
                <span class="rl-name"><span class="rl-title">${escapeHtml(region.short)}</span> ${badge(d, sample)}</span>
                <span class="rl-sub" id="rl-sub-${region.id}">
                    ${sample ? '<span class="sample-tag">exemplo</span>' : `<span class="rl-trend t-${tr.direction}">${escapeHtml(tr.text)}</span>`}
                    ${concern ? `<span class="rl-fc lvl-${concern.danger.level}">${concern.danger.label} previsto ${concern.hoursAhead <= 1 ? "na próxima hora" : `em até ${concern.hoursAhead} h`}</span>` : ""}
                </span>
                ${stale ? `<span class="rl-age">dado de ${agoText(region.recordedAt, state.now)}</span>` : ""}
            </span>
            <span class="rl-aside">
                <span class="rl-rain ${c.rain ? "is-changed" : ""}">${fmt1(region.rain)}<small> mm/h</small></span>
                <span class="rl-spark">${sample ? "" : sparkline(region.recent, { width: 64, height: 20 })}</span>
            </span>
        </button>
    </li>`;
}

function renderList() {
    const state = store.get();
    const thresholds = effectiveThresholds(state);
    const list = $("#regionList");
    const sorted = sortByDanger(Object.values(state.regions), thresholds);
    if (!sorted.length) { list.innerHTML = ""; return; }
    list.innerHTML = sorted.map(({ region, danger }) => rowHtml(region, danger, state)).join("");
    $("#rlCount").textContent = String(sorted.length);
}

function nowcastBlock(region, state) {
    const n = nowcastText(region.nowcast, state.model);
    if (!n) {
        return `<div class="next3 muted"><h4>Próximas 3 h</h4>
            <p>${state.model && state.model.available ? "Sem previsão do modelo para esta região agora." : "Previsão do modelo indisponível no servidor."}</p>
            ${forecastNextHours(region, state)}</div>`;
    }
    return `<div class="next3 ${n.alert ? "alert" : ""}">
        <h4>Próximas 3 h</h4>
        <p class="next3-head">${n.alert ? '<span class="next3-flag">Atenção</span>' : ""}${escapeHtml(n.headline)}</p>
        ${n.expected ? `<p class="next3-sub">${escapeHtml(n.expected)}</p>` : ""}
        ${forecastNextHours(region, state)}
        <p class="next3-quality">${escapeHtml(n.quality)}</p>
    </div>`;
}

function forecastNextHours(region, state) {
    const thresholds = effectiveThresholds(state);
    const next = (region.series || []).filter(p => p.kind === "forecast" && p.t > state.now - 1_800_000).slice(0, 3);
    if (!next.length) return "";
    return `<ul class="next3-hours">${next.map(p => {
        const d = levelOf(p, thresholds);
        return `<li><span>${fmtClock(p.t)}</span><span>${fmt1(p.rain)} mm/h</span><span class="lvl-${d.level}"><span class="lvl-dot lvl-${d.level}" aria-hidden="true"></span>${d.label}</span></li>`;
    }).join("")}</ul><p class="next3-src">Chuva prevista hora a hora (Open-Meteo).</p>`;
}

function renderDetail() {
    const state = store.get();
    const view = $("#regionDetail");
    const id = state.selectedRegion;
    const region = id ? state.regions[id] : null;
    $("#sidePanel").classList.toggle("show-detail", !!region);
    if (!region) { view.innerHTML = ""; return; }
    const thresholds = effectiveThresholds(state);
    const d = levelOf(region, thresholds);
    const sample = state.source === "sample";
    const tr = trendInfo(region, state.now);
    const cuts = thresholds.riskCuts || DEFAULT_RISK_CUTS;
    // preserva estado de leitura entre redesenhos (atualização automática)
    const tableOpen = !!view.querySelector(".chart-table[open]");
    const scroll = view.dataset.region === id ? $("#sidePanel .side-scroll").scrollTop : 0;
    const focusedId = view.contains(document.activeElement) ? document.activeElement.id : null;
    view.innerHTML = `
        <button type="button" class="rd-back" id="rdBack">${icon("chevron-left")} Todas as regiões</button>
        <div class="rd-head lvl-${sample ? "sample" : d.level}">
            <div><h3 id="rdTitle" tabindex="-1">${escapeHtml(region.short)}</h3><p class="rd-sub">${escapeHtml(region.name)}</p></div>
            ${badge(d, sample)}
        </div>
        ${sample ? '<p class="pu-age sample">Dados de exemplo — sem conexão com o servidor. Não use para decisões.</p>' : `
        <p class="rd-reason">Nível ${d.label.toLowerCase()} por ${escapeHtml(d.reason)}.</p>
        <dl class="rd-facts">
            <div><dt>Chuva agora</dt><dd>${fmt1(region.rain)} mm/h</dd></div>
            <div><dt>Índice de risco</dt><dd>${region.risk ?? "—"}/100${region.riskSource === "ml" ? "" : ' <small>(heurístico)</small>'}</dd></div>
            <div><dt>Tendência</dt><dd>${escapeHtml(tr.text)}</dd></div>
            <div><dt>Leitura</dt><dd>${region.recordedAt ? `${fmtClock(region.recordedAt)} · ${agoText(region.recordedAt, state.now)}` : "—"}</dd></div>
        </dl>
        ${nowcastBlock(region, state)}
        <h4 class="rd-h">Chuva por hora</h4>
        ${state.hasSeries ? rainBars(region.series, { now: state.now, thresholds }) : '<p class="chart-empty">O servidor ainda não oferece a série horária (/weather/overview).</p>'}
        <h4 class="rd-h">Índice de risco</h4>
        ${state.hasSeries ? riskLine(region.series, { now: state.now, cuts }) : ""}
        ${state.hasSeries ? dataTable(region.series, thresholds) : ""}
        <p class="rd-model">${escapeHtml(modelQualityText(state.model))}</p>`}
    `;
    if (tableOpen) { const t = view.querySelector(".chart-table"); if (t) t.open = true; }
    $("#sidePanel .side-scroll").scrollTop = scroll;
    if (focusedId) { const el = document.getElementById(focusedId); if (el) el.focus({ preventScroll: true }); }
    view.dataset.region = id;
    $("#rdBack").addEventListener("click", () => {
        store.set({ selectedRegion: null });
        const row = document.querySelector(`.rl-row[data-region="${id}"]`);
        if (row) row.focus();
    });
}

export function selectRegion(id, { focusMap = true } = {}) {
    store.set({ selectedRegion: id });
    setDrawer(true);
    if (focusMap) onFocusRegion(id);
    requestAnimationFrame(() => { const t = $("#rdTitle"); if (t) t.focus(); });
}

function setDrawer(open) {
    const panel = $("#sidePanel");
    panel.classList.toggle("open", open);
    // a gaveta precisa ficar acima do veredito/cabeçalho no celular
    panel.closest(".map-wrap").classList.toggle("drawer-open", open);
    $("#btnRegions").setAttribute("aria-expanded", String(open));
}

export function initRegionList() {
    $("#regionList").addEventListener("click", e => {
        const row = e.target.closest(".rl-row");
        if (row) selectRegion(row.dataset.region);
    });
    $("#btnRegions").addEventListener("click", () => setDrawer(!$("#sidePanel").classList.contains("open")));
    $("#sideClose").addEventListener("click", () => { setDrawer(false); $("#btnRegions").focus(); });
    store.subscribe(s => [s.regions, effectiveThresholds(s), s.source, s.now, s.changes], renderList);
    store.subscribe(s => [s.selectedRegion, s.regions, effectiveThresholds(s), s.source, s.now, s.model, s.hasSeries], renderDetail);
}
