/*
 * Operação (Fase 3): equipes, despacho, cobertura, pré-posicionamento, ocorrências e indicadores.
 *
 * Perfis: operador (despacha e edita) e gestor (lê indicadores). A credencial é pedida na aba
 * "Operação" e fica só nesta aba do navegador (sessionStorage). O cidadão nunca vê esta aba.
 * Equipes são DADOS DE EXEMPLO (fictícios) até haver integração real — rotulados em todo lugar.
 */
import { ApiError, opsApi } from "./api.js";
import { icon } from "./icons.js";
import { forecastConcern, withinText } from "./insights.js";
import { setDrawer } from "./regionlist.js";
import { districtLabel } from "./regions.js";
import { routes as osrmRoutes, pickRoute, travelTimes, estimateMinutes } from "./routing.js";
import { effectiveThresholds, regionList, store } from "./state.js";
import { showToast } from "./ui.js";
import { $, $$, escapeHtml, fmt1, fmtClock, fmtDateTime, storage } from "./util.js";
import type { Incident, OpsRole, Team } from "./types.js";

const TOKEN_KEY = "climasp_ops_token";
const DATA = "data/geo/";

export const KINDS = {
    defesa_civil: { label: "Defesa Civil", icon: "shield" },
    bombeiros: { label: "Bombeiros", icon: "flame" },
    cet: { label: "CET", icon: "cone" },
    samu: { label: "SAMU", icon: "ambulance" },
    subprefeitura: { label: "Subprefeitura", icon: "building" },
};
export const STATUS = {
    disponivel: { label: "Disponível", icon: "check" },
    em_deslocamento: { label: "Em deslocamento", icon: "arrow-right" },
    em_ocorrencia: { label: "Em ocorrência", icon: "alert-triangle" },
    indisponivel: { label: "Indisponível", icon: "x" },
};
const INCIDENT_STEPS = [
    ["aberta", "Aberta"], ["despachada", "Equipe designada"], ["no_local", "No local"], ["resolvida", "Resolvida"],
];

let token = storage.get<string>(TOKEN_KEY, null, "session");
let mapApi: any = null;
/** Matriz OSRM pré-calculada (data/geo/coverage.json): minutos[base][célula]. */
interface Coverage { bases: string[]; cells: string[]; minutes: (number | null)[][] }
interface BaseInfo { key: string; lat: number; lng: number; name: string; kinds: string[] }

let coverage: Coverage | null = null;
let basesInfo: BaseInfo[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

/* ------------------------------------------------------------ autenticação e carga */

async function call<A extends unknown[], R>(fn: (token: string, ...args: A) => Promise<R>, ...args: A): Promise<R> {
    try {
        return await fn(token ?? "", ...args);
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) logout("Credencial expirada ou inválida.");
        throw err;
    }
}

async function login(value) {
    const t = value.trim();
    if (!t) return;
    try {
        const me = await opsApi.me(t);
        token = t;
        storage.set(TOKEN_KEY, t, "session");
        store.set({ opsRole: me.role, opsError: null });
        await refresh();
        startPolling();
    } catch (err) {
        const msg = err instanceof ApiError
            ? (err.status === 503 ? err.detail : err.status === 401 ? "Credencial inválida." : `Erro ${err.status}.`)
            : "Servidor indisponível.";
        store.set({ opsError: msg });
    }
}

function logout(message: string | null = null) {
    token = null;
    storage.remove(TOKEN_KEY, "session");
    if (pollTimer) clearInterval(pollTimer);
    store.set({ opsRole: null, opsTeams: [], opsIncidents: [], opsReport: null, opsError: message, opsTarget: null, opsCandidates: null });
}

async function refresh() {
    if (!token) return;
    const [teams, incidents] = await Promise.all([call(opsApi.teams), call(opsApi.incidents)]);
    store.set({ opsTeams: teams, opsIncidents: incidents });
}

async function loadReport() {
    const hours = Number($<HTMLSelectElement>("#opsReportHours").value || 24);
    store.set({ opsReport: { loading: true } });
    try {
        store.set({ opsReport: await call(opsApi.report, hours) });
    } catch (err) {
        store.set({ opsReport: { error: "Não foi possível carregar os indicadores." } });
    }
}

function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => refresh().catch(() => {}), 30_000);
}

/* ------------------------------------------------------------ cobertura (isócronas) */

async function loadCoverage() {
    if (coverage) return coverage;
    try {
        const [cov, bases] = await Promise.all([
            fetch(`${DATA}coverage.json`).then(r => (r.ok ? r.json() : null)),
            fetch(`${DATA}example-bases.json`).then(r => (r.ok ? r.json() : null)),
        ]);
        coverage = cov;
        basesInfo = bases ? bases.bases : [];
    } catch (_) {
        coverage = null;
    }
    return coverage;
}

/** Minutos da base de uma equipe até uma célula (pré-calculado pelo OSRM), ou null. */
function baseMinutes(team: Team, h3: string): number | null {
    if (!coverage) return null;
    const key = `${team.base_lat.toFixed(5)},${team.base_lng.toFixed(5)}`;
    const bi = coverage.bases.indexOf(key);
    const ci = coverage.cells.indexOf(h3);
    if (bi < 0 || ci < 0) return null;
    return coverage.minutes[bi][ci];
}

/** Menor tempo até cada célula a partir das bases que têm equipes do tipo escolhido. */
function coverageMinutes(kind: string): (number | null)[] {
    if (!coverage) return [];
    const cov = coverage;
    const rows = cov.bases.map((key, i) => ({ key, row: cov.minutes[i] }))
        .filter(({ key }) => {
            const info = basesInfo.find(b => b.key === key);
            return info && (kind === "todas" || info.kinds.includes(kind));
        });
    return cov.cells.map((_, ci) => {
        let best: number | null = null;
        for (const { row } of rows) { const v = row[ci]; if (v != null && (best == null || v < best)) best = v; }
        return best;
    });
}

const BANDS = [
    { max: 5, cls: "cov-5", label: "até 5 min" },
    { max: 10, cls: "cov-10", label: "5–10 min" },
    { max: 15, cls: "cov-15", label: "10–15 min" },
    { max: Infinity, cls: "cov-gap", label: "mais de 15 min (buraco de cobertura)" },
];

let coverageLayer: L.LayerGroup | null = null;
async function renderCoverage() {
    const on = $<HTMLInputElement>("#opsCoverageToggle").checked;
    const summary = $("#opsCoverageSummary");
    if (!on) { if (coverageLayer) mapApi.map.removeLayer(coverageLayer); summary.textContent = ""; return; }
    const cov = await loadCoverage();
    if (!cov) {
        summary.textContent = "Cobertura ainda não calculada (data/geo/coverage.json ausente).";
        return;
    }
    const kind = $<HTMLSelectElement>("#opsCoverageKind").value;
    const mins = coverageMinutes(kind);
    const byH3 = new Map(cov.cells.map((h3, i) => [h3, mins[i]]));
    if (!coverageLayer) {
        const geo = await fetch(`${DATA}hex-zona-norte.geojson`).then(r => r.json());
        coverageLayer = L.geoJSON(geo, { pane: "lines", interactive: true, style: { weight: 0, fillOpacity: 0.55 } });
        coverageLayer.eachLayer((l: any) => l.bindTooltip(() => {
            const v = l._covMinutes;
            return v == null ? "Sem rota calculada" : `${fmt1(v)} min da base mais próxima (${$<HTMLSelectElement>("#opsCoverageKind").selectedOptions[0].text})`;
        }, { sticky: true }));
    }
    const counts = BANDS.map(() => 0);
    coverageLayer.eachLayer((l: any) => {
        const v = byH3.get(l.feature.properties.h3);
        l._covMinutes = v;
        const band = v == null ? BANDS.length - 1 : BANDS.findIndex(b => v <= b.max);
        counts[band]++;
        l.setStyle({ fillOpacity: band === 3 ? 1 : 0.82 });
        const el = l.getElement && l.getElement();
        if (el) el.setAttribute("class", `leaflet-interactive cov ${BANDS[band].cls}`);
        l.options.className = `cov ${BANDS[band].cls}`;
    });
    if (!mapApi.map.hasLayer(coverageLayer)) {
        coverageLayer.addTo(mapApi.map);
        coverageLayer.eachLayer((l: any) => { const el = l.getElement(); if (el) el.setAttribute("class", `leaflet-interactive ${l.options.className}`); });
    }
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const within10 = Math.round(((counts[0] + counts[1]) / total) * 100);
    summary.innerHTML = `<strong>${within10}%</strong> da área alcançada em até 10 min · ` +
        `<strong>${counts[3]}</strong> células acima de 15 min` +
        `<span class="pu-note"> Tempos de carro sem trânsito (OSRM), a partir das bases das equipes de exemplo.</span>`;
    $("#opsCoverageLegend").innerHTML = BANDS.map((b, i) => `<li><span class="cov-swatch ${b.cls}"></span>${b.label} <span class="pu-note">(${counts[i]})</span></li>`).join("");
}

/* ------------------------------------------------------------ equipes no mapa */

let teamsLayer: L.LayerGroup | null = null;
let incidentsLayer: L.LayerGroup | null = null;

function teamIcon(team) {
    const k = KINDS[team.kind] || KINDS.defesa_civil;
    return L.divIcon({
        className: `team-pin st-${team.status}`,
        html: `<span class="team-badge kind-${team.kind}"><svg class="i" aria-hidden="true"><use href="#i-${k.icon}"></use></svg>` +
            `<b class="team-st" aria-hidden="true">${icon(STATUS[team.status]?.icon || "x")}</b></span>`,
        iconSize: [32, 32], iconAnchor: [16, 16], popupAnchor: [0, -14],
    });
}

function teamPopup(team) {
    const k = KINDS[team.kind];
    return `<div class="pu ps"><div class="pu-name">${escapeHtml(team.name)}</div>
        <div class="ps-note">${k.label} · <strong>${STATUS[team.status].label}</strong></div>
        <div class="ps-note">Base: ${escapeHtml(team.base_name)}</div>
        ${team.is_example ? '<div class="pu-age sample">EXEMPLO FICTÍCIO — equipe inexistente, só para demonstrar o fluxo.</div>' : ""}
        <div class="pu-note">Local da base: ${escapeHtml(team.base_source)}</div></div>`;
}

function renderTeamsOnMap(teams) {
    if (!teamsLayer) teamsLayer = L.layerGroup().addTo(mapApi.map);
    teamsLayer.clearLayers();
    for (const t of teams) {
        L.marker([t.lat, t.lng], { icon: teamIcon(t), title: `${t.name} — ${STATUS[t.status].label}`, alt: `${t.name} — ${STATUS[t.status].label}` })
            .bindPopup(teamPopup(t), { maxWidth: 300 })
            .addTo(teamsLayer);
    }
}

function renderIncidentsOnMap(incidents) {
    if (!incidentsLayer) incidentsLayer = L.layerGroup().addTo(mapApi.map);
    incidentsLayer.clearLayers();
    for (const inc of incidents.filter(i => i.status !== "resolvida")) {
        const label = `Ocorrência #${inc.id} — ${stepLabel(inc.status)}`;
        L.marker([inc.lat, inc.lng], {
            icon: L.divIcon({ className: `inc-pin inc-${inc.status}`, html: `<span class="inc-badge">${icon("alert-triangle")}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
            title: label, alt: label,
        }).bindPopup(`<div class="pu ps"><div class="pu-name">${escapeHtml(label)}</div><div class="ps-note">${escapeHtml(inc.description || inc.kind)}</div></div>`)
            .addTo(incidentsLayer);
    }
}

/* ------------------------------------------------------------ despacho: 3 mais rápidas */

let targetMarker: L.Marker | null = null;
let routeLayer: L.LayerGroup | null = null;
let picking = false;

const isDrawer = () => window.matchMedia("(max-width: 1024px)").matches;

function setPicking(on) {
    picking = on;
    // no celular a gaveta cobre o mapa: fecha para escolher o ponto e reabre com o resultado
    if (on && isDrawer()) setDrawer(false);
    mapApi.map.getContainer().classList.toggle("picking", on);
    $("#opsPick").setAttribute("aria-pressed", String(on));
    $("#opsPick").textContent = on ? "Clique no mapa… (Esc cancela)" : "Escolher ponto no mapa";
}

/**
 * Despacho calculado no servidor (serviço Java com GraphHopper/OSRM). Devolve null quando o
 * backend não tem a rota (só o FastAPI: 404) ou falha — aí o cálculo segue no navegador.
 */
async function nearestFromServer(point: { lat: number; lng: number }) {
    try {
        const r = await call(opsApi.nearest, point.lat, point.lng, 5);
        const list = r.candidates.map(c => {
            const best = pickRoute(c.routes, mapApi.isCritical);
            return { team: c.team, minutes: best.minutes, route: best, estimated: c.estimated || best.estimated };
        }).sort((a, b) => a.minutes - b.minutes).slice(0, 3);
        return { list, estimated: r.estimated, source: r.source };
    } catch (err) {
        if (!(err instanceof ApiError) || ![404, 405, 501].includes(err.status)) console.warn("Despacho no servidor indisponível:", err);
        return null;
    }
}

export async function nearestTeams(point) {
    const server = await nearestFromServer(point);
    if (server) return server;
    const teams = (store.get().opsTeams || []).filter(t => t.status === "disponivel");
    if (!teams.length) return { list: [], estimated: false };
    const { minutes, estimated } = await travelTimes(teams.map(t => ({ lat: t.lat, lng: t.lng })), point);
    const ranked = teams.map((t, i) => ({ team: t, minutes: minutes[i] }))
        .filter(x => x.minutes != null)
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, 5);
    // rotas reais das 5 primeiras, preferindo trajetos fora de zonas críticas
    const withRoutes: any[] = [];
    for (const c of ranked) {
        const options = await osrmRoutes({ lat: c.team.lat, lng: c.team.lng }, point);
        const best = pickRoute(options, mapApi.isCritical);
        withRoutes.push({ ...c, minutes: best.minutes, route: best, estimated: estimated || best.estimated });
    }
    withRoutes.sort((a, b) => a.minutes - b.minutes);
    return { list: withRoutes.slice(0, 3), estimated };
}

async function chooseTarget(latlng) {
    setPicking(false);
    if (isDrawer()) setDrawer(true);
    const point = { lat: latlng.lat, lng: latlng.lng };
    if (targetMarker) mapApi.map.removeLayer(targetMarker);
    targetMarker = L.marker([point.lat, point.lng], {
        icon: L.divIcon({ className: "target-pin", html: `<span class="target-badge">${icon("crosshair")}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] }),
        title: "Ponto selecionado para despacho", alt: "Ponto selecionado para despacho",
    }).addTo(mapApi.map);
    const place = mapApi.locate(point.lat, point.lng);
    store.set({ opsTarget: { ...point, place }, opsCandidates: { loading: true } });
    try {
        store.set({ opsCandidates: await nearestTeams(point) });
    } catch (err) {
        console.warn(err);
        store.set({ opsCandidates: { error: "Não foi possível calcular as equipes mais próximas." } });
    }
}

function drawRoute(candidate) {
    if (!routeLayer) routeLayer = L.layerGroup().addTo(mapApi.map);
    routeLayer.clearLayers();
    if (!candidate) return;
    L.polyline(candidate.route.coords, { pane: "lines", color: "#11151B", weight: 8, opacity: 0.45 }).addTo(routeLayer);
    L.polyline(candidate.route.coords, {
        pane: "lines", color: "#2F6DB5", weight: 4, opacity: 0.95, dashArray: candidate.route.estimated ? "6 6" : undefined,
        className: "dispatch-route",
    }).addTo(routeLayer);
    // trechos críticos destacados
    const coords = candidate.route.coords;
    for (let i = 0; i < coords.length - 1; i++) {
        if (mapApi.isCritical(coords[i][0], coords[i][1])) {
            L.polyline([coords[i], coords[i + 1]], { pane: "lines", color: "#BE1554", weight: 6, opacity: 0.95, className: "route-critical" }).addTo(routeLayer);
        }
    }
}

async function dispatch(idx) {
    const state = store.get();
    const cand = state.opsCandidates?.list?.[idx];
    const target = state.opsTarget;
    if (!cand || !target) return;
    try {
        const description = $<HTMLInputElement>("#opsDescription").value.trim();
        const incident = await call(opsApi.openIncident, {
            lat: target.lat, lng: target.lng, kind: "alagamento", description,
            address: target.place?.district ? `Distrito ${target.place.district}` : "",
        });
        await call(opsApi.assign, incident.id, { team_id: cand.team.id, eta_minutes: Math.round(cand.minutes) });
        showToast(`${cand.team.name} despachada — chegada estimada em ${Math.round(cand.minutes)} min.`);
        store.set({ opsCandidates: null, opsTarget: null });
        if (targetMarker) { mapApi.map.removeLayer(targetMarker); targetMarker = null; }
        drawRoute(null);
        $<HTMLInputElement>("#opsDescription").value = "";
        await refresh();
    } catch (err) {
        showToast(err instanceof ApiError && err.detail ? err.detail : "Falha ao despachar.");
    }
}

/* ------------------------------------------------------------ pré-posicionamento */

/**
 * Para cada região com chuva forte prevista (próximas 3 h) ou alerta do modelo, sugere levar a
 * equipe disponível de Defesa Civil ou Bombeiros mais rápida até a célula mais suscetível da região.
 */
export function suggestions(state, cells) {
    const thresholds = effectiveThresholds(state);
    const out: any[] = [];
    if (state.source !== "live") return out;
    const free = (state.opsTeams || []).filter(t => t.status === "disponivel" && (t.kind === "defesa_civil" || t.kind === "bombeiros"));
    const used = new Set();
    for (const region of regionList(state.regions)) {
        const concern = forecastConcern(region, thresholds, state.now);
        const alert = region.nowcast && region.nowcast.alert;
        if (!concern && !alert) continue;
        const regionCells = cells.filter(c => c.region === region.id && c.susc != null);
        if (!regionCells.length) continue;
        const target = regionCells.reduce((a, b) => (b.susc > a.susc ? b : a));
        let best: any = null;
        for (const t of free) {
            if (used.has(t.id)) continue;
            const atBase = Math.abs(t.lat - t.base_lat) < 1e-5 && Math.abs(t.lng - t.base_lng) < 1e-5;
            const table = atBase ? baseMinutes(t, target.h3) : null;
            const mins = table ?? estimateMinutes(t, target);
            if (!best || mins < best.minutes) best = { team: t, minutes: mins, fromTable: table != null };
        }
        if (!best) continue;
        used.add(best.team.id);
        out.push({
            region, target, team: best.team, minutes: best.minutes, fromTable: best.fromTable,
            why: concern ? `${concern.danger.label} previsto ${withinText(concern.hoursAhead)}` : "modelo sinaliza chance de chuva forte",
        });
    }
    return out;
}

async function prePosition(idx) {
    const s = currentSuggestions[idx];
    if (!s) return;
    try {
        await call(opsApi.patchTeam, s.team.id, { lat: s.target.lat, lng: s.target.lng });
        showToast(`${s.team.name} pré-posicionada em ${s.region.short}.`);
        await refresh();
    } catch (err) {
        showToast(err instanceof ApiError && err.detail ? err.detail : "Falha ao pré-posicionar.");
    }
}

/* ------------------------------------------------------------ renderização do painel */

let currentSuggestions: any[] = [];

function stepLabel(status) {
    return (INCIDENT_STEPS.find(([s]) => s === status) || [null, status])[1];
}

function timelineHtml(inc, teams) {
    const reached = INCIDENT_STEPS.findIndex(([s]) => s === inc.status);
    const at = { aberta: inc.opened_at, despachada: inc.assigned_at, no_local: inc.arrived_at, resolvida: inc.resolved_at };
    return `<ol class="inc-steps">${INCIDENT_STEPS.map(([s, label], i) => `
        <li class="${i <= reached ? "done" : ""} ${i === reached ? "current" : ""}">
            <span class="inc-dot" aria-hidden="true">${i <= reached ? icon("check") : ""}</span>
            <span>${label}${at[s] ? ` <time datetime="${at[s]}">${fmtClock(Date.parse(at[s]))}</time>` : ""}</span>
        </li>`).join("")}</ol>`;
}

function incidentCard(inc, teams, role) {
    const team = teams.find(t => t.id === inc.team_id);
    const canAct = role === "operador" && inc.status !== "resolvida";
    const actions = !canAct ? "" : inc.status === "despachada"
        ? `<button type="button" class="ops-btn" data-act="arrive" data-id="${inc.id}">Equipe chegou</button>
           <button type="button" class="ops-btn ghost" data-act="resolve" data-id="${inc.id}">Resolver</button>`
        : inc.status === "no_local"
            ? `<button type="button" class="ops-btn" data-act="resolve" data-id="${inc.id}">Resolver</button>`
            : `<button type="button" class="ops-btn ghost" data-act="focus" data-id="${inc.id}">Escolher equipe</button>`;
    return `<li class="inc-card inc-${inc.status}">
        <div class="inc-head"><strong>#${inc.id} · ${escapeHtml(inc.kind)}</strong>
            <span class="inc-when">${fmtDateTime(Date.parse(inc.opened_at))}</span></div>
        ${inc.description ? `<p class="inc-desc">${escapeHtml(inc.description)}</p>` : ""}
        <p class="inc-meta">${escapeHtml(inc.address || "")}${inc.region ? ` · região ${escapeHtml(inc.region)}` : ""}
            ${team ? ` · ${escapeHtml(team.name)}` : ""}${inc.eta_minutes != null && inc.status === "despachada" ? ` · chegada estimada em ${Math.round(inc.eta_minutes)} min` : ""}</p>
        ${timelineHtml(inc, teams)}
        ${actions ? `<div class="inc-actions">${actions}</div>` : ""}
    </li>`;
}

function candidatesHtml(c) {
    if (!c) return "";
    if (c.loading) return '<p class="ops-note" role="status">Calculando tempos por ruas…</p>';
    if (c.error) return `<p class="ops-note">${escapeHtml(c.error)}</p>`;
    if (!c.list.length) return '<p class="ops-note">Nenhuma equipe disponível no momento.</p>';
    const role = store.get().opsRole;
    return `<ol class="cand-list">${c.list.map((x, i) => `
        <li class="cand">
            <button type="button" class="cand-main" data-route="${i}" aria-label="Mostrar rota de ${escapeHtml(x.team.name)}">
                <span class="cand-rank">${i + 1}</span>
                <span class="cand-body"><strong>${escapeHtml(x.team.name)}</strong>
                    <span class="cand-sub">${KINDS[x.team.kind].label} · <strong>${Math.round(x.minutes)} min</strong>${x.route.km ? ` · ${fmt1(x.route.km)} km` : ""}${x.estimated ? " (estimativa em linha reta)" : ""}</span>
                    <span class="cand-flag ${x.route.critical && !x.route.avoided ? "warn" : ""}">${x.route.critical && !x.route.avoided
                        ? `${icon("alert-triangle")} passa por zona crítica`
                        : `${icon("check")} ${x.route.avoided ? "rota alternativa evita zona crítica" : "rota fora de zona crítica"}`}</span>
                </span>
            </button>
            ${role === "operador" ? `<button type="button" class="ops-btn" data-dispatch="${i}">Despachar</button>` : ""}
        </li>`).join("")}</ol>
        <p class="pu-note">Tempo de carro sem trânsito (OSRM). ${c.estimated ? "Serviço de rotas indisponível: valores estimados." : ""}</p>`;
}

function reportHtml(r) {
    if (!r) return '<p class="ops-note">Clique em "Atualizar" para gerar os indicadores.</p>';
    if (r.loading) return '<p class="ops-note" role="status">Gerando…</p>';
    if (r.error) return `<p class="ops-note">${escapeHtml(r.error)}</p>`;
    const rain = Object.entries((r.rain || {}) as Record<string, { total_mm: number | null }>).map(([code, v]) => `<li>${escapeHtml(code)}: <strong>${fmt1(v.total_mm)} mm</strong></li>`).join("") || "<li>sem dados</li>";
    const m = r.model;
    const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);
    const mins = v => (v == null ? "—" : `${fmt1(v)} min`);
    return `<dl class="rep">
        <div><dt>Chuva acumulada</dt><dd><ul class="rep-rain">${rain}</ul></dd></div>
        <div><dt>Ocorrências</dt><dd><strong>${r.incidents.total}</strong> (${r.incidents.by_status.resolvida || 0} resolvidas)</dd></div>
        <div><dt>Tempo até despacho</dt><dd>${mins(r.incidents.mean_minutes_to_dispatch)}</dd></div>
        <div><dt>Tempo até chegada</dt><dd>${mins(r.incidents.mean_minutes_to_arrival)}</dd></div>
        <div><dt>Tempo até resolução</dt><dd>${mins(r.incidents.mean_minutes_to_resolution)}</dd></div>
        <div><dt>Acerto do modelo</dt><dd>${m.evaluated ? `precisão ${pct(m.precision)} · detecção ${pct(m.recall)} <span class="pu-note">(${m.evaluated} previsões verificadas)</span>` : escapeHtml(m.note || "—")}</dd></div>
    </dl>`;
}

function renderPanel() {
    const state = store.get();
    const role = state.opsRole;
    $("#opsLogin").hidden = !!role;
    $("#opsBody").hidden = !role;
    $("#opsLoginError").textContent = state.opsError || "";
    $("#opsLoginError").hidden = !state.opsError;
    if (!role) return;
    $("#opsWho").textContent = role === "operador" ? "Operador" : "Gestor (somente leitura)";
    $("#opsDispatchBox").hidden = role !== "operador";
    const teams = state.opsTeams || [];
    const incidents = state.opsIncidents || [];

    // sugestões
    currentSuggestions = role === "operador" && mapApi ? suggestions(state, mapApi.cells()) : [];
    $("#opsSuggestions").innerHTML = currentSuggestions.length
        ? currentSuggestions.map((s, i) => `<li class="sug">
            <p><strong>${escapeHtml(s.region.short)}</strong>: ${escapeHtml(s.why)}. Posicionar <strong>${escapeHtml(s.team.name)}</strong>
            perto da área mais suscetível (distrito ${escapeHtml(districtLabel(s.target.district))}${s.target.nearest_stream ? `, ${Math.round(s.target.dist_stream_m)} m do ${escapeHtml(s.target.nearest_stream)}` : ""}).
            <span class="pu-note">~${Math.round(s.minutes)} min${s.fromTable ? " (OSRM)" : " (estimativa)"}.</span></p>
            <button type="button" class="ops-btn" data-preposition="${i}">Pré-posicionar</button></li>`).join("")
        : '<li class="ops-note">Nenhuma chuva forte prevista nas próximas 3 h — sem sugestões.</li>';

    // despacho
    $("#opsCandidates").innerHTML = candidatesHtml(state.opsCandidates);
    $("#opsTargetInfo").textContent = state.opsTarget
        ? `Ponto: ${state.opsTarget.place?.inside ? `distrito ${state.opsTarget.place.district}` : "fora da área monitorada"} (${state.opsTarget.lat.toFixed(4)}, ${state.opsTarget.lng.toFixed(4)})`
        : "";

    // ocorrências
    const active = incidents.filter(i => i.status !== "resolvida");
    const done = incidents.filter(i => i.status === "resolvida").slice(0, 10);
    $("#opsIncidents").innerHTML = active.length ? active.map(i => incidentCard(i, teams, role)).join("") : '<li class="ops-note">Nenhuma ocorrência ativa.</li>';
    $("#opsResolved").innerHTML = done.map(i => incidentCard(i, teams, role)).join("");
    $("#opsResolvedCount").textContent = String(done.length);

    // equipes
    $("#opsTeams").innerHTML = teams.map(t => `<li class="team-row">
        <span class="team-badge kind-${t.kind} small" aria-hidden="true"><svg class="i"><use href="#i-${KINDS[t.kind].icon}"></use></svg></span>
        <span class="team-name">${escapeHtml(t.name)}<span class="pu-note"> ${KINDS[t.kind].label}</span></span>
        ${role === "operador"
            ? `<label class="sr-only" for="st-${t.id}">Status de ${escapeHtml(t.name)}</label>
               <select id="st-${t.id}" data-team-status="${t.id}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${v.label}</option>`).join("")}</select>`
            : `<span class="team-st-text">${STATUS[t.status].label}</span>`}
    </li>`).join("");
    $("#opsTeamsNote").hidden = !teams.some(t => t.is_example);

    $("#opsReport").innerHTML = reportHtml(state.opsReport);
}

/* ------------------------------------------------------------ inicialização */

function setTab(tab) {
    $$(".side-tab").forEach(b => {
        const on = b.dataset.tab === tab;
        b.classList.toggle("active", on);
        b.setAttribute("aria-selected", String(on));
    });
    $("#sidePanel").dataset.tab = tab;
    store.set({ sideTab: tab });
}

export function initOps(api) {
    mapApi = api;
    const showTab = () => {
        const visible = store.get().operator || !!token || !!store.get().opsRole;
        $("#tabOps").hidden = !visible;
        // com duas abas, vira controle segmentado; com uma só, título grande
        $(".side-tabs").classList.toggle("segmented", visible);
        if (!visible && store.get().sideTab === "ops") setTab("regions");
    };
    store.subscribe(s => [s.operator, s.opsRole], showTab);
    $$(".side-tab").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

    $("#opsLoginForm").addEventListener("submit", e => { e.preventDefault(); login($<HTMLInputElement>("#opsToken").value); $<HTMLInputElement>("#opsToken").value = ""; });
    $("#opsLogout").addEventListener("click", () => logout());
    $("#opsExitMode").addEventListener("click", () => $("#operatorExit").click());
    $("#opsPick").addEventListener("click", () => setPicking(!picking));
    $("#opsReportRefresh").addEventListener("click", loadReport);
    $("#opsCoverageToggle").addEventListener("change", renderCoverage);
    $("#opsCoverageKind").addEventListener("change", renderCoverage);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && picking) setPicking(false); });
    api.map.on("click", e => { if (picking) { api.map.closePopup(); chooseTarget(e.latlng); } });

    $("#opsPanel").addEventListener("click", async e => {
        const t = (e.target as Element).closest("button");
        if (!t) return;
        if (t.dataset.dispatch) dispatch(Number(t.dataset.dispatch));
        else if (t.dataset.route) drawRoute(store.get().opsCandidates?.list?.[Number(t.dataset.route)]);
        else if (t.dataset.preposition) prePosition(Number(t.dataset.preposition));
        else if (t.dataset.act) {
            const id = Number(t.dataset.id);
            try {
                if (t.dataset.act === "arrive") await call(opsApi.arrive, id);
                if (t.dataset.act === "resolve") await call(opsApi.resolve, id, "");
                if (t.dataset.act === "focus") {
                    const inc = store.get().opsIncidents.find(i => i.id === id);
                    if (inc) { api.map.setView([inc.lat, inc.lng], 15); chooseTarget({ lat: inc.lat, lng: inc.lng }); }
                    return;
                }
                await refresh();
            } catch (err) {
                showToast(err instanceof ApiError && err.detail ? err.detail : "Falha na operação.");
            }
        }
    });
    $("#opsPanel").addEventListener("change", async e => {
        const sel = (e.target as Element).closest<HTMLSelectElement>("[data-team-status]");
        if (!sel) return;
        try { await call(opsApi.patchTeam, Number(sel.dataset.teamStatus), { status: sel.value as Team["status"] }); await refresh(); }
        catch (err) { showToast(err instanceof ApiError && err.detail ? err.detail : "Falha ao mudar status."); }
    });

    store.subscribe(s => [s.opsRole, s.opsTeams, s.opsIncidents, s.opsReport, s.opsError, s.opsCandidates, s.opsTarget, s.regions, s.now], renderPanel);
    store.subscribe(s => [s.opsRole, s.opsTeams], ([role, teams]) => {
        if (!role) { teamsLayer?.clearLayers(); return; }
        renderTeamsOnMap(teams || []);
    });
    store.subscribe(s => [s.opsRole, s.opsIncidents], ([role, incs]) => {
        if (!role) { incidentsLayer?.clearLayers(); return; }
        renderIncidentsOnMap(incs || []);
    });
    store.subscribe(s => s.opsCandidates, c => drawRoute(c && c.list ? c.list[0] : null));

    if (token) {
        opsApi.me(token).then(me => { store.set({ opsRole: me.role }); refresh().catch(() => {}); startPolling(); })
            .catch(() => logout());
    }
}

