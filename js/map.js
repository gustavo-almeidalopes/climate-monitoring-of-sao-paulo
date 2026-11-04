/*
 * Mapa Leaflet: mapa base (segue o tema), perímetros dos distritos, zonas de
 * perigo e rótulos. Tudo é redesenhado por assinatura no store — nenhum
 * módulo precisa chamar funções de render manualmente.
 */
import { regionPopup } from "./popup.js";
import { DISTRICT_TO_REGION, REGION_META } from "./regions.js";
import { SAMPLE_COLOR, dangerFromRain } from "./risk.js";
import { effectiveThresholds, store } from "./state.js";
import { hideLoading, setLoadingState } from "./ui.js";
import { $$, escapeHtml, haversineKm, normalizeName, pointInGeometry, storage } from "./util.js";

const L = window.L;
const BASE_KEY = "climasp_base_layer";
const GEOJSON_URL = "https://raw.githubusercontent.com/codigourbano/distritos-sp/master/distritos-sp.geojson";
/* Fase 2 substitui estes círculos por zonas que seguem o território. */
const ZONE_RADIUS_M = 1800;
const POPUP_OPTS = { maxWidth: 320, autoPanPadding: [50, 50] };

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

export function initMap() {
    const map = L.map("map", { zoomControl: false, center: [-23.475, -46.61], zoom: 12, zoomSnap: 0.5 });
    L.control.zoom({ position: "topleft", zoomInTitle: "Aproximar", zoomOutTitle: "Afastar" }).addTo(map);

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

    /* ---------- camadas de dados ---------- */
    const grpRegions = L.layerGroup().addTo(map);
    const grpZones = L.layerGroup().addTo(map);
    const regionLayers = []; // { id, layer, approximate }
    const zones = {};
    const labels = {};
    let districtFeatures = null; // [{ regionId, name, geometry }]

    $$("[data-overlay]").forEach(btn => btn.addEventListener("click", () => {
        const on = !btn.classList.contains("on");
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-checked", String(on));
        const group = btn.dataset.overlay === "regions" ? grpRegions : grpZones;
        if (on) map.addLayer(group); else map.removeLayer(group);
    }));

    function addLabels() {
        for (const meta of Object.values(REGION_META)) {
            labels[meta.id] = L.marker([meta.lat, meta.lng], {
                interactive: false,
                keyboard: false,
                icon: L.divIcon({
                    className: "subpref-label",
                    html: `<div class="subpref-label-inner">${escapeHtml(meta.short)}</div>`,
                    iconSize: [110, 24],
                    iconAnchor: [55, 12],
                }),
            }).addTo(grpRegions);
        }
    }

    function paint() {
        const state = store.get();
        const thresholds = effectiveThresholds(state);
        const sample = state.source === "sample";

        for (const { id, layer, approximate } of regionLayers) {
            const region = state.regions[id];
            if (!region) continue;
            const d = dangerFromRain(region.rain, thresholds);
            const color = sample ? SAMPLE_COLOR : d.color;
            layer.setStyle({ color, fillColor: color, fillOpacity: sample ? 0.5 : 0.12, weight: 1.6, opacity: 0.9, dashArray: sample ? "4 4" : null });
            layer.getElement()?.classList.toggle("zone-sample", sample);
            layer.setPopupContent(regionPopup(region, thresholds, { now: state.now, approximate }));
        }

        for (const region of Object.values(state.regions)) {
            const d = dangerFromRain(region.rain, thresholds);
            const color = sample ? SAMPLE_COLOR : d.color;
            const strong = !sample && d.rank >= 2;
            let circle = zones[region.id];
            if (!circle) {
                circle = L.circle([region.lat, region.lng], { radius: ZONE_RADIUS_M }).addTo(grpZones);
                circle.bindPopup("", POPUP_OPTS);
                zones[region.id] = circle;
            }
            circle.setStyle({
                color, fillColor: color, opacity: 0.9,
                fillOpacity: sample ? 0.5 : strong ? 0.32 : 0.13,
                weight: strong ? 2.8 : 1.6,
                dashArray: sample ? "4 4" : null,
            });
            circle.getElement()?.classList.toggle("zone-sample", sample);
            circle.setPopupContent(regionPopup(region, thresholds, { now: state.now }));
            labels[region.id]?.getElement()?.classList.toggle("is-sample", sample);
        }
    }

    function registerLayer(id, layer, approximate = false) {
        layer.bindPopup("", POPUP_OPTS);
        regionLayers.push({ id, layer, approximate });
    }

    function renderFallback() {
        for (const [id, coords] of Object.entries(FALLBACK_POLYGONS)) {
            registerLayer(id, L.polygon(coords).addTo(grpRegions), true);
        }
    }

    setLoadingState("districts");
    addLabels();
    store.subscribe(s => [s.regions, effectiveThresholds(s), s.source, s.now], paint);

    fetch(GEOJSON_URL)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(geo => {
            districtFeatures = [];
            L.geoJSON(geo, {
                filter: f => identifyDistrict(f.properties) !== null,
                onEachFeature: (f, layer) => {
                    const hit = identifyDistrict(f.properties);
                    districtFeatures.push({ regionId: hit.regionId, name: titleCase(hit.name), geometry: f.geometry });
                    registerLayer(hit.regionId, layer);
                },
            }).addTo(grpRegions);
            zonesToFront();
        })
        .catch(err => {
            console.warn("Limites dos distritos indisponíveis; usando contornos aproximados.", err);
            renderFallback();
            zonesToFront();
        })
        .finally(() => { paint(); hideLoading(); });

    function zonesToFront() {
        // os distritos chegam depois das zonas; as zonas ficam por cima para continuarem clicáveis
        grpZones.eachLayer(l => l.bringToFront && l.bringToFront());
    }

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

    return { map, locate };
}
