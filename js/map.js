/*
 * Mapa Leaflet — zonas de perigo fiéis ao território (Fase 2).
 *
 *  - Distritos oficiais pintados pela cor do nível (critério único de js/risk.js).
 *  - Grade hexagonal H3 (data/geo/hex-zona-norte.geojson): nível da região ajustado pela
 *    suscetibilidade da célula (terreno baixo, perto de córrego, histórico de ocorrências).
 *  - Linguagem visual: observado = preenchimento sólido; previsto (linha do tempo) =
 *    hachura no padrão do nível + contorno tracejado; borda esmaecida; só o crítico pulsa.
 *  - Rótulos dinâmicos ("Santana · 12,4 mm/h"); foco automático na pior área.
 * Tudo é redesenhado por assinatura no store.
 */
import { regionAtOffset } from "./insights.js";
import { regionPopup } from "./popup.js";
import { DISTRICT_TO_REGION, REGION_META } from "./regions.js";
import { setFocusHandler, selectRegion } from "./regionlist.js";
import { LEVELS, SAMPLE_COLOR, levelOf } from "./risk.js";
import { effectiveThresholds, store } from "./state.js";
import { hideLoading, setLoadingState } from "./ui.js";
import { $$, escapeHtml, fmt1, haversineKm, normalizeName, pointInGeometry, storage } from "./util.js";

const L = window.L;
const BASE_KEY = "climasp_base_layer";
const GEOJSON_URL = "https://raw.githubusercontent.com/codigourbano/distritos-sp/master/distritos-sp.geojson";
const HEX_URL = "data/geo/hex-zona-norte.geojson";
const POPUP_OPTS = { maxWidth: 330, autoPanPadding: [50, 50] };
const ORDER = ["low", "medium", "high", "critical"];

const OSM_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
const ESRI_ATTR = "Imagens &copy; Esri — Esri, Maxar, Earthstar Geographics e comunidade de usuários GIS";

function makeTiles() {
    const carto = style => L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
        attribution: CARTO_ATTR, subdomains: "abcd", maxZoom: 19,
    });
    return {
        light: () => [carto("light_all")],
        dark: () => [carto("dark_all")],
        satellite: () => [
            L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
                attribution: ESRI_ATTR, maxZoom: 19,
            }),
            L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", {
                maxZoom: 19, opacity: 0.85,
            }),
        ],
        osm: () => [L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: OSM_ATTR, maxZoom: 19 })],
    };
}

/* Contornos aproximados desenhados à mão — usados só se o GeoJSON oficial não carregar,
   e sempre identificados como "aproximados" no popup. */
const FALLBACK_POLYGONS = {
    CV: [[-23.51, -46.645], [-23.512, -46.65], [-23.506, -46.685], [-23.495, -46.688], [-23.455, -46.682], [-23.445, -46.66], [-23.45, -46.64], [-23.48, -46.64]],
    ST: [[-23.51, -46.645], [-23.48, -46.64], [-23.45, -46.64], [-23.44, -46.61], [-23.465, -46.605], [-23.495, -46.595], [-23.521, -46.6], [-23.513, -46.638]],
    JT: [[-23.48, -46.598], [-23.465, -46.605], [-23.445, -46.595], [-23.415, -46.57], [-23.43, -46.54], [-23.465, -46.55], [-23.485, -46.58]],
    MG: [[-23.521, -46.6], [-23.495, -46.595], [-23.485, -46.58], [-23.495, -46.56], [-23.52, -46.552], [-23.528, -46.57], [-23.524, -46.595]],
};

function identifyDistrict(props) {
    for (const key of Object.keys(props || {})) {
        if (typeof props[key] !== "string") continue;
        const name = normalizeName(props[key]);
        if (DISTRICT_TO_REGION[name]) return { regionId: DISTRICT_TO_REGION[name], name };
    }
    return null;
}

const titleCase = s => s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());

/**
 * Nível da célula hexagonal: o nível da região sobe UM degrau quando a célula está entre as
 * 10% mais suscetíveis da grade (corte calculado dos dados) e a região já está em Médio ou acima. Nunca desce — num painel
 * de emergência, a suscetibilidade só pode chamar atenção, não tranquilizar.
 */
export function cellLevel(regionDanger, susc, cut = 0.66) {
    if (susc != null && susc >= cut && regionDanger.rank >= LEVELS.medium.rank && regionDanger.rank < LEVELS.critical.rank) {
        const up = LEVELS[ORDER[regionDanger.rank + 1]];
        return { ...up, reason: `${regionDanger.reason}; célula baixa/perto de córrego` };
    }
    return regionDanger;
}

function cellPopup(props, region, danger, thresholds, state) {
    const lines = [];
    if (props.elev_m != null) {
        const rel = props.rel_elev_m;
        lines.push(`Altitude ${fmt1(props.elev_m)} m${rel != null ? ` (${rel < 0 ? `${fmt1(Math.abs(rel))} m abaixo` : `${fmt1(rel)} m acima`} do entorno)` : ""}`);
    }
    if (props.dist_stream_m != null) lines.push(`${Math.round(props.dist_stream_m)} m de ${escapeHtml(props.nearest_stream || "curso d'água")}`);
    if (props.occurrences != null) lines.push(`${props.occurrences} ocorrência(s) de alagamento registrada(s) na célula e vizinhas`);
    const susc = props.susc != null ? `Suscetibilidade relativa: ${fmt1(props.susc * 10)}/10` : "Suscetibilidade não calculada (sem dados de relevo).";
    return `${regionPopup(region, thresholds, { now: state.now, model: state.model })}
        <div class="pu-cellinfo"><div class="pu-next-h">Esta célula (${escapeHtml(titleCase(props.district || ""))})</div>
        <div>${susc}${danger.rank > levelOf(region, thresholds).rank ? " — entre as 10% mais suscetíveis: <strong>nível elevado um degrau</strong>" : ""}</div>
        ${lines.map(l => `<div class="pu-note">${l}</div>`).join("")}
        <div class="pu-note">Índice experimental. Fontes: relevo (Copernicus/SRTM), cursos d'água (OSM), ocorrências (GeoSampa).</div></div>`;
}

export function initMap() {
    const map = L.map("map", { zoomControl: false, center: [-23.475, -46.61], zoom: 12, zoomSnap: 0.5 });
    L.control.zoom({ position: "topleft", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(map);

    // Panes: preenchimento (com borda esmaecida), contornos nítidos, linhas e rótulos.
    map.createPane("radar").style.zIndex = 350;
    map.createPane("zonesFill").style.zIndex = 400;
    map.createPane("zonesLine").style.zIndex = 410;
    map.createPane("lines").style.zIndex = 420;
    const fillRenderer = L.svg({ pane: "zonesFill", padding: 0.5 });
    const lineRenderer = L.svg({ pane: "zonesLine", padding: 0.5 });

    /* ---------- mapa base ---------- */
    const tiles = makeTiles();
    let activeBase = [];
    const savedBase = storage.get(BASE_KEY, "auto");
    store.set({ baseLayer: ["auto", "satellite", "osm"].includes(savedBase) ? savedBase : "auto" });
    store.subscribe(s => [s.theme, s.baseLayer], ([theme, base]) => {
        const key = base === "auto" ? (theme === "light" ? "light" : "dark") : base;
        activeBase.forEach(layer => map.removeLayer(layer));
        activeBase = tiles[key]();
        activeBase.forEach(layer => layer.addTo(map)); // ordem importa: imagem e depois vias
        map.getContainer().dataset.basemap = key;
        $$(".lp-row[data-base]").forEach(btn => {
            const on = btn.dataset.base === base;
            btn.classList.toggle("on", on);
            btn.setAttribute("aria-checked", String(on));
        });
    });
    $$(".lp-row[data-base]").forEach(btn => btn.addEventListener("click", () => {
        storage.set(BASE_KEY, btn.dataset.base);
        store.set({ baseLayer: btn.dataset.base });
    }));

    /* ---------- grupos ---------- */
    const grpDistrictFill = L.layerGroup().addTo(map);   // distritos pintados (sem grade)
    const grpHex = L.layerGroup();                       // grade hexagonal
    const grpOutlines = L.layerGroup().addTo(map);       // perímetros
    const grpLabels = L.layerGroup().addTo(map);
    const groups = { flood_zones: null, regions: grpOutlines }; // flood_zones decide entre grade e distritos
    let zonesOn = true;
    let hexOn = true;

    const districtFills = []; // { id, layer, approximate }
    const outlines = [];      // { id, layer }
    const hexCells = [];      // { props, layer }
    let suscCut = 0.66;       // recalculado: percentil 90 da suscetibilidade da grade
    const labels = {};
    let districtFeatures = null;
    const regionBounds = {};

    function syncZoneGroups() {
        const useHex = hexOn && hexCells.length > 0;
        const want = (g, on) => { if (on && !map.hasLayer(g)) map.addLayer(g); if (!on && map.hasLayer(g)) map.removeLayer(g); };
        want(grpHex, zonesOn && useHex);
        want(grpDistrictFill, zonesOn && !useHex);
        map.getContainer().dataset.zones = !zonesOn ? "off" : useHex ? "hex" : "districts";
        if (painting) paint(); // o Leaflet recria os elementos SVG ao readicionar um grupo
    }
    let painting = false;

    $$('.lp-row[data-overlay]').forEach(btn => btn.addEventListener("click", () => {
        const on = !btn.classList.contains("on");
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-checked", String(on));
        const key = btn.dataset.overlay;
        if (key === "flood_zones") { zonesOn = on; syncZoneGroups(); return; }
        if (key === "hex") { hexOn = on; syncZoneGroups(); return; }
        const group = groups[key];
        if (group) { if (on) map.addLayer(group); else map.removeLayer(group); if (on && painting) paint(); }
    }));

    function addLabels() {
        for (const meta of Object.values(REGION_META)) {
            labels[meta.id] = L.marker([meta.lat, meta.lng], {
                interactive: false, keyboard: false,
                icon: L.divIcon({ className: "subpref-label", html: `<div class="subpref-label-inner">${escapeHtml(meta.short)}</div>`, iconSize: null, iconAnchor: [0, 0] }),
            }).addTo(grpLabels);
        }
    }

    /* ---------- pintura ---------- */
    function zoneStyle(danger, { sample, forecast, opacity }) {
        const color = sample ? SAMPLE_COLOR : danger.color;
        return {
            color, fillColor: color, weight: 0, opacity: 0,
            fillOpacity: sample ? 0.45 : opacity,
        };
    }

    function setClasses(layer, classes) {
        const el = layer.getElement && layer.getElement();
        if (!el) return;
        const interactive = layer.options.interactive !== false ? "leaflet-interactive " : "";
        el.setAttribute("class", `${interactive}${classes}`);
    }

    function paint() {
        const state = store.get();
        const thresholds = effectiveThresholds(state);
        const sample = state.source === "sample";
        const offset = state.timeOffset || 0;
        const at = {};
        for (const [id, region] of Object.entries(state.regions)) {
            at[id] = regionAtOffset(region, offset, state.now) || null;
        }
        const anyForecast = Object.values(at).some(r => r && r.kind === "forecast");
        map.getContainer().dataset.timeKind = offset === 0 ? "now" : anyForecast ? "forecast" : "observed";

        const kindClass = r => (r && r.kind === "forecast" ? "z-forecast" : "z-observed");

        for (const { id, layer, approximate } of districtFills) {
            const r = at[id];
            if (!r) { layer.setStyle({ fillOpacity: 0.04, fillColor: SAMPLE_COLOR }); setClasses(layer, "z-nodata"); continue; }
            const d = levelOf(r, thresholds);
            layer.setStyle(zoneStyle(d, { sample, opacity: 0.22 + d.rank * 0.08 }));
            setClasses(layer, `${sample ? "zone-sample" : `lvl-${d.level} ${kindClass(r)}`}`);
            layer.setPopupContent(regionPopup(r, thresholds, { now: state.now, approximate, model: state.model }));
        }

        for (const { id, layer } of outlines) {
            const r = at[id];
            const d = r ? levelOf(r, thresholds) : LEVELS.low;
            const color = sample || !r ? SAMPLE_COLOR : d.color;
            layer.setStyle({ color, weight: d.rank >= 2 && !sample ? 2.4 : 1.4, opacity: 0.95, fill: false, dashArray: sample || (r && r.kind === "forecast") ? "6 5" : null });
            setClasses(layer, `z-outline ${!sample && r && r.kind !== "forecast" && d.level === "critical" ? "z-pulse" : ""}`);
        }

        for (const { props, layer } of hexCells) {
            const r = at[props.region];
            if (!r) { layer.setStyle({ fillOpacity: 0.03, fillColor: SAMPLE_COLOR }); setClasses(layer, "z-nodata"); continue; }
            const regionDanger = levelOf(r, thresholds);
            const d = sample ? regionDanger : cellLevel(regionDanger, props.susc, suscCut);
            const s = props.susc == null ? 0.4 : props.susc;
            // gradiente: células mais suscetíveis ficam mais intensas
            const opacity = d.rank === 0 ? 0.06 + 0.16 * s : 0.16 + 0.42 * s + d.rank * 0.05;
            layer.setStyle(zoneStyle(d, { sample, opacity }));
            setClasses(layer, `hex ${sample ? "zone-sample" : `lvl-${d.level} ${kindClass(r)}`} ${!sample && r.kind !== "forecast" && d.level === "critical" ? "z-pulse" : ""}`);
            layer._climasp = { region: r, danger: d, thresholds };
        }

        for (const [id, marker] of Object.entries(labels)) {
            const r = at[id];
            const el = marker.getElement();
            if (!el) continue;
            const inner = el.querySelector(".subpref-label-inner");
            if (!r) { inner.textContent = REGION_META[id].short; continue; }
            const d = levelOf(r, thresholds);
            inner.innerHTML = sample
                ? `${escapeHtml(r.short)} · exemplo`
                : `<span class="lvl-dot lvl-${d.level}" aria-hidden="true"></span>${escapeHtml(r.short)} · ${fmt1(r.rain)} mm/h${r.kind === "forecast" ? " <em>prev.</em>" : ""}`;
            el.classList.toggle("is-sample", sample);
            el.classList.toggle("is-forecast", r.kind === "forecast");
        }
    }

    function registerDistrict(id, fillLayer, outlineLayer, approximate = false) {
        fillLayer.bindPopup("", POPUP_OPTS);
        districtFills.push({ id, layer: fillLayer, approximate });
        outlines.push({ id, layer: outlineLayer });
        const b = fillLayer.getBounds();
        regionBounds[id] = regionBounds[id] ? regionBounds[id].extend(b) : L.latLngBounds(b.getSouthWest(), b.getNorthEast());
    }

    function renderFallback() {
        for (const [id, coords] of Object.entries(FALLBACK_POLYGONS)) {
            const fill = L.polygon(coords, { renderer: fillRenderer, stroke: false }).addTo(grpDistrictFill);
            const line = L.polygon(coords, { renderer: lineRenderer, fill: false, interactive: false }).addTo(grpOutlines);
            registerDistrict(id, fill, line, true);
        }
    }

    setLoadingState("districts");
    addLabels();

    const districtsReady = fetch(GEOJSON_URL)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(geo => {
            districtFeatures = [];
            for (const f of geo.features || []) {
                const hit = identifyDistrict(f.properties);
                if (!hit) continue;
                districtFeatures.push({ regionId: hit.regionId, name: titleCase(hit.name), geometry: f.geometry });
                const fill = L.geoJSON(f, { renderer: fillRenderer, style: { stroke: false } }).getLayers()[0];
                fill.addTo(grpDistrictFill);
                const line = L.geoJSON(f, { renderer: lineRenderer, style: { fill: false }, interactive: false }).getLayers()[0];
                line.addTo(grpOutlines);
                registerDistrict(hit.regionId, fill, line);
            }
        })
        .catch(err => {
            console.warn("Limites dos distritos indisponíveis; usando contornos aproximados.", err);
            renderFallback();
        });

    const hexReady = fetch(HEX_URL)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(geo => {
            L.geoJSON(geo, {
                renderer: fillRenderer,
                style: { stroke: false },
                onEachFeature: (f, layer) => {
                    hexCells.push({ props: f.properties, layer });
                    layer.bindPopup(() => {
                        const info = layer._climasp;
                        const state = store.get();
                        if (!info) return "Sem dados.";
                        return cellPopup(f.properties, info.region, info.danger, info.thresholds, state);
                    }, POPUP_OPTS);
                },
            }).addTo(grpHex);
            const values = hexCells.map(c => c.props.susc).filter(v => v != null).sort((a, b) => a - b);
            if (values.length) suscCut = values[Math.floor(values.length * 0.9)];
            map.getContainer().dataset.suscCut = String(suscCut);
        })
        .catch(err => console.warn("Grade hexagonal indisponível; zonas pelos distritos.", err));

    Promise.allSettled([districtsReady, hexReady]).then(() => {
        syncZoneGroups();
        painting = true;
        store.subscribe(s => [s.regions, effectiveThresholds(s), s.source, s.now, s.timeOffset], paint);
        hideLoading();
        focusWorstOnce();
    });

    /* ---------- foco ---------- */
    function focusRegion(id) {
        const b = regionBounds[id];
        if (b) map.flyToBounds(b, { padding: [40, 40], maxZoom: 14, duration: 0.8 });
        else if (REGION_META[id]) map.flyTo([REGION_META[id].lat, REGION_META[id].lng], 13, { duration: 0.8 });
    }
    setFocusHandler(focusRegion);

    /** Foco automático na pior área — uma vez por sessão, só com dado real em Alto ou Crítico. */
    let focused = false;
    function focusWorstOnce() {
        store.subscribe(s => [s.source, s.regions], ([source, regions]) => {
            if (focused || source !== "live") return;
            const thresholds = effectiveThresholds(store.get());
            const list = Object.values(regions).map(r => ({ r, d: levelOf(r, thresholds) }))
                .sort((a, b) => b.d.rank - a.d.rank || (b.r.rain ?? 0) - (a.r.rain ?? 0));
            if (!list.length) return;
            focused = true;
            const top = list[0];
            if (top.d.rank >= LEVELS.high.rank && list.filter(x => x.d.rank === top.d.rank).length < list.length) {
                focusRegion(top.r.id);
                map.getContainer().dataset.autofocus = top.r.id;
            }
        });
    }

    // "Ver detalhes" dentro de qualquer popup abre o painel da região
    map.getContainer().addEventListener("click", e => {
        const btn = e.target.closest('[data-action="details"]');
        if (btn) { map.closePopup(); selectRegion(btn.dataset.region, { focusMap: false }); }
    });

    /**
     * Em qual região monitorada está o ponto?
     * Com os limites oficiais: teste de ponto-em-polígono (exato).
     * Sem eles: região mais próxima num raio de 4 km do centro (aproximado).
     */
    function locate(lat, lng) {
        let nearest = null;
        for (const meta of Object.values(REGION_META)) {
            const distanceKm = haversineKm(lat, lng, meta.lat, meta.lng);
            if (!nearest || distanceKm < nearest.distanceKm) nearest = { regionId: meta.id, distanceKm };
        }
        if (districtFeatures) {
            const hit = districtFeatures.find(f => pointInGeometry(lat, lng, f.geometry));
            if (hit) return { inside: true, exact: true, regionId: hit.regionId, district: hit.name, distanceKm: 0 };
            return { inside: false, exact: true, ...nearest };
        }
        return { inside: nearest.distanceKm <= 4, exact: false, ...nearest };
    }

    return { map, locate, focusRegion };
}
