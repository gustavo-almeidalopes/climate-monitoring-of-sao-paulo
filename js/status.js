/*
 * Estado da conexão e cartões de resumo.
 *
 * Regra de honestidade: dado de exemplo nunca aparece com cara de dado real —
 * banner explícito, valores acinzentados com a etiqueta "exemplo" e nenhum alerta.
 */
import { dangerFromRain, worstRegion } from "./risk.js";
import { effectiveThresholds, store } from "./state.js";
import { loadWeather } from "./weather.js";
import { $, escapeHtml, fmt1, fmtClock, timeAgo } from "./util.js";

const SAMPLE_TAG = '<span class="sample-tag">exemplo</span>';

function renderStatus([connection, source]) {
    const dot = $("#statusDot");
    const label = $("#statusLabel");
    let state = connection;
    let text;
    if (connection === "loading") text = source === "none" ? "Conectando…" : "Atualizando…";
    else if (connection === "online") text = "Ao vivo";
    else { state = "offline"; text = "Sem conexão"; }
    dot.className = `status-dot ${state}`;
    label.textContent = text;
}

function renderBanner([connection, source, updatedAt, now]) {
    const banner = $("#connBanner");
    document.body.classList.toggle("is-sample", source === "sample");
    document.body.classList.toggle("is-stale", source === "live" && connection === "offline");

    if (source === "sample") {
        banner.dataset.kind = "sample";
        $("#connBannerTitle").textContent =
            "Sem conexão com o servidor — exibindo dados de exemplo, não use para decisões.";
        $("#connBannerText").textContent = "Números e cores abaixo são ilustrativos.";
        banner.hidden = false;
    } else if (source === "live" && connection === "offline") {
        banner.dataset.kind = "stale";
        $("#connBannerTitle").textContent = "Conexão perdida.";
        $("#connBannerText").textContent =
            `Mostrando a última leitura real, de ${fmtClock(updatedAt)} (${timeAgo(updatedAt, now)}).`;
        banner.hidden = false;
    } else if (connection !== "loading") {
        banner.hidden = true;
    }
}

function statValue(id, html, sample) {
    const el = $(id);
    el.innerHTML = html + (sample ? SAMPLE_TAG : "");
    el.classList.toggle("is-sample", sample);
}

function renderStats([regions, thresholds, source, updatedAt, now]) {
    const list = Object.values(regions);
    if (!list.length) return;
    const sample = source === "sample";

    const temps = list.map(r => r.temp).filter(v => v != null);
    const avgTemp = temps.length ? temps.reduce((s, v) => s + v, 0) / temps.length : null;
    statValue("#statTemp", `${fmt1(avgTemp)}<span class="unit"> °C</span>`, sample);

    const rains = list.filter(r => r.rain != null);
    const maxRain = rains.length ? rains.reduce((a, b) => (b.rain > a.rain ? b : a)) : null;
    statValue("#statRain", `${fmt1(maxRain ? maxRain.rain : null)}<span class="unit"> mm/h</span>`, sample);

    const worst = worstRegion(list, thresholds);
    const d = worst ? worst.danger : dangerFromRain(0, thresholds);
    statValue(
        "#statRegion",
        `${escapeHtml(worst ? worst.region.short : "—")} <span class="badge badge-${d.level}">${d.label}</span>`,
        sample,
    );

    const updated = $("#statUpdated");
    if (sample) {
        updated.innerHTML = 'sem conexão';
        updated.classList.add("is-sample");
    } else {
        updated.textContent = updatedAt ? `${fmtClock(updatedAt)} · ${timeAgo(updatedAt, now)}` : "—";
        updated.classList.remove("is-sample");
    }
}

export function initStatus() {
    store.subscribe(s => [s.connection, s.source], renderStatus);
    store.subscribe(s => [s.connection, s.source, s.updatedAt, s.now], renderBanner);
    store.subscribe(s => [s.regions, effectiveThresholds(s), s.source, s.updatedAt, s.now], renderStats);
    $("#connRetry").addEventListener("click", () => loadWeather());
}
