/*
 * Gráficos em SVG, sem biblioteca.
 *  - sparkline: chuva das últimas 6 h (lista de regiões);
 *  - rainBars: chuva por hora, −24 h…+48 h — observado sólido, previsto hachurado;
 *  - riskLine: índice de risco 0–100 com a faixa crítica sombreada;
 *  - dataTable: a mesma informação em tabela (leitor de tela / teclado).
 * Cada barra/ponto tem dica ao passar o mouse ([data-tip], via tooltips.js).
 * Lacunas na série (servidor parado) ficam como lacunas — nada é interpolado.
 */
import { LEVELS, levelOf } from "./risk.js";
import { escapeHtml, fmt1, fmtClock, fmtDateTime } from "./util.js";

const HOUR = 3_600_000;

export function sparkline(points, { width = 84, height = 24, label = "Chuva nas últimas 6 h" } = {}) {
    const pts = (points || []).filter(p => p.rain != null);
    if (pts.length < 2) return `<span class="spark-empty" title="${escapeHtml(label)}: sem histórico">—</span>`;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const realMax = Math.max(...pts.map(p => p.rain));
    const max = Math.max(1, realMax);
    const x = t => (t1 === t0 ? width : ((t - t0) / (t1 - t0)) * (width - 4) + 2);
    const y = v => height - 3 - (v / max) * (height - 6);
    let d = "";
    pts.forEach((p, i) => {
        const gap = i > 0 && p.t - pts[i - 1].t > 1.5 * HOUR;
        d += `${i === 0 || gap ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.rain).toFixed(1)}`;
    });
    const last = pts[pts.length - 1];
    const summary = `${label}: de ${fmt1(pts[0].rain)} a ${fmt1(last.rain)} mm/h, máximo ${fmt1(realMax)} mm/h`;
    return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(summary)}">
        <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(last.t).toFixed(1)}" cy="${y(last.rain).toFixed(1)}" r="2.5" fill="currentColor"/>
    </svg>`;
}

function timeAxis(t0, t1, now) {
    const pos = t => (((t - t0) / (t1 - t0)) * 100).toFixed(2);
    const ticks = [];
    for (let h = -24; h <= 48; h += 12) {
        const t = now + h * HOUR;
        if (t < t0 || t > t1) continue;
        const label = h === 0 ? "agora" : `${h > 0 ? "+" : "−"}${Math.abs(h)} h`;
        ticks.push(`<span class="ax-tick ${h === 0 ? "now" : ""}" style="left:${pos(t)}%">${label}</span>`);
    }
    return `<div class="chart-axis" aria-hidden="true">${ticks.join("")}</div>`;
}

/**
 * Barras de chuva por hora. series: [{ t, kind, rain, risk, riskSource }].
 */
export function rainBars(series, { now = Date.now(), thresholds }) {
    const pts = (series || []).filter(p => p.rain != null);
    if (!pts.length) return '<p class="chart-empty">Sem série horária disponível.</p>';
    const hourNow = new Date(now).setMinutes(0, 0, 0);
    const t0 = hourNow - 24 * HOUR, t1 = hourNow + 48 * HOUR;
    const inRange = pts.filter(p => p.t >= t0 && p.t <= t1);
    const W = 720, H = 140, top = 8, bottom = H - 2;
    const maxRain = Math.max(5, ...inRange.map(p => p.rain));
    const yMax = maxRain * 1.1;
    const slot = W / 72;
    const x = t => ((t - t0) / (t1 - t0)) * W;
    const y = v => bottom - (v / yMax) * (bottom - top);
    const bars = inRange.map(p => {
        const bx = x(p.t) - slot / 2 + 1, bw = Math.max(1.5, slot - 2);
        const h = Math.max(p.rain > 0 ? 1.5 : 0, bottom - y(p.rain));
        const d = levelOf(p, thresholds);
        const tip = `${p.kind === "forecast" ? "Previsto" : "Observado"} · ${fmtDateTime(p.t)}: ${fmt1(p.rain)} mm/h · nível ${d.label}`;
        return `<g class="bar ${p.kind}" data-tip="${escapeHtml(tip)}">
            <rect class="hit" x="${bx - 1}" y="${top}" width="${bw + 2}" height="${bottom - top}" fill="transparent"/>
            <rect class="mark" x="${bx.toFixed(1)}" y="${(bottom - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="0.8"/>
        </g>`;
    }).join("");
    const refs = [["medium", thresholds.yellow], ["high", thresholds.orange], ["critical", thresholds.red]]
        .filter(([, v]) => v <= yMax)
        .map(([lvl, v]) => `<line class="ref ref-${lvl}" x1="0" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`)
        .join("");
    const refLabels = [["medium", thresholds.yellow], ["high", thresholds.orange], ["critical", thresholds.red]]
        .filter(([, v]) => v <= yMax)
        .map(([lvl, v]) => `<span class="ref-label lvl-${lvl}" style="top:${((y(v) / H) * 100).toFixed(1)}%">${v}</span>`)
        .join("");
    return `<div class="chart" role="img" aria-label="Gráfico de barras da chuva por hora, das últimas 24 horas às próximas 48 horas. Máximo de ${fmt1(maxRain)} mm/h. Dados também na tabela abaixo.">
        <div class="chart-ymax" aria-hidden="true">${fmt1(maxRain)} mm/h</div>
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg rain">
            ${refs}
            <line class="now-line" x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="0" y2="${H}"/>
            ${bars}
        </svg>
        <div class="ref-labels" aria-hidden="true">${refLabels}</div>
        ${timeAxis(t0, t1, hourNow)}
        <div class="chart-key" aria-hidden="true"><span class="key-obs"></span>observado <span class="key-fc"></span>previsto (hachurado)</div>
    </div>`;
}

/** Linha do índice de risco 0–100 com a faixa crítica. */
export function riskLine(series, { now = Date.now(), cuts }) {
    const pts = (series || []).filter(p => p.risk != null);
    if (!pts.length) return '<p class="chart-empty">Sem série de risco disponível.</p>';
    const hourNow = new Date(now).setMinutes(0, 0, 0);
    const t0 = hourNow - 24 * HOUR, t1 = hourNow + 48 * HOUR;
    const inRange = pts.filter(p => p.t >= t0 && p.t <= t1);
    const W = 720, H = 110, top = 4, bottom = H - 4;
    const x = t => ((t - t0) / (t1 - t0)) * W;
    const y = v => bottom - (Math.max(0, Math.min(100, v)) / 100) * (bottom - top);
    const segs = { observed: "", forecast: "" };
    let prev = null;
    for (const p of inRange) {
        const start = !prev || p.t - prev.t > 1.5 * HOUR || prev.kind !== p.kind;
        if (start && prev && prev.kind !== p.kind && p.t - prev.t <= 1.5 * HOUR) {
            segs[p.kind] += `M${x(prev.t).toFixed(1)},${y(prev.risk).toFixed(1)}`; // costura entre observado e previsto
            segs[p.kind] += `L${x(p.t).toFixed(1)},${y(p.risk).toFixed(1)}`;
        } else {
            segs[p.kind] += `${start ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.risk).toFixed(1)}`;
        }
        prev = p;
    }
    const hits = inRange.map(p => {
        const tip = `${p.kind === "forecast" ? "Previsto" : "Observado"} · ${fmtDateTime(p.t)}: risco ${p.risk}/100` +
            (p.riskSource === "ml" ? "" : " (índice heurístico)");
        return `<rect class="hit" data-tip="${escapeHtml(tip)}" x="${(x(p.t) - 5).toFixed(1)}" y="0" width="10" height="${H}" fill="transparent"/>`;
    }).join("");
    const heuristic = inRange.some(p => p.riskSource !== "ml");
    return `<div class="chart" role="img" aria-label="Linha do índice de risco de 0 a 100, com a faixa crítica a partir de ${cuts.critical}. Dados também na tabela abaixo.">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="chart-svg risk">
            <rect class="band-critical" x="0" y="${y(100)}" width="${W}" height="${(y(cuts.critical) - y(100)).toFixed(1)}"/>
            <line class="ref ref-high" x1="0" x2="${W}" y1="${y(cuts.high).toFixed(1)}" y2="${y(cuts.high).toFixed(1)}"/>
            <line class="now-line" x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="0" y2="${H}"/>
            <path class="risk-obs" d="${segs.observed}" vector-effect="non-scaling-stroke"/>
            <path class="risk-fc" d="${segs.forecast}" vector-effect="non-scaling-stroke"/>
            ${hits}
        </svg>
        <div class="band-label" aria-hidden="true">faixa crítica ≥ ${cuts.critical}</div>
        ${timeAxis(t0, t1, hourNow)}
        ${heuristic ? '<p class="chart-note">Parte da série usa o índice heurístico (sem modelo), que não define o nível.</p>' : ""}
    </div>`;
}

export function dataTable(series, thresholds) {
    const rows = (series || []).map(p => {
        const d = levelOf(p, thresholds);
        return `<tr><td>${fmtDateTime(p.t)}</td><td>${p.kind === "forecast" ? "previsto" : "observado"}</td>` +
            `<td>${fmt1(p.rain)}</td><td>${p.risk ?? "—"}</td><td><span class="lvl-dot lvl-${d.level}" aria-hidden="true"></span>${d.label}</td></tr>`;
    }).join("");
    return `<details class="chart-table"><summary>Ver dados em tabela</summary>
        <div class="table-scroll" tabindex="0" role="region" aria-label="Tabela de chuva e risco por hora (role para ver tudo)"><table><caption class="sr-only">Chuva e risco por hora</caption>
        <thead><tr><th scope="col">Hora</th><th scope="col">Tipo</th><th scope="col">Chuva (mm/h)</th><th scope="col">Risco</th><th scope="col">Nível</th></tr></thead>
        <tbody>${rows}</tbody></table></div></details>`;
}

export function clockRange(series) {
    if (!series || !series.length) return "";
    return `${fmtClock(series[0].t)}–${fmtClock(series[series.length - 1].t)}`;
}
