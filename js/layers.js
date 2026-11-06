/*
 * Camadas de dados geográficos reais (Fase 2). Procedência em data/geo/metadata.json,
 * gerado por scripts/build_geodata.py no GitHub Actions:
 *  - cursos d'água, vias e pontos de apoio: OpenStreetMap (ODbL);
 *  - manchas e ocorrências de alagamento: GeoSampa (Prefeitura de São Paulo), quando a
 *    licença foi verificada (ver docs/fase-2/fontes.md);
 *  - radar de chuva: RainViewer (uso gratuito com atribuição obrigatória).
 * Notícias aparecem no mapa pela menção a um distrito monitorado (localização aproximada).
 */
import { api } from "./api.js";
import { clusterLayer, clusterPin, svgPin } from "./cluster.js";
import { REGION_META, districtLabel } from "./regions.js";
import { $$, escapeHtml, fmtClock, normalizeName, stripEmoji, timeAgo } from "./util.js";
const DATA = "data/geo/";
const RAINVIEWER = "https://api.rainviewer.com/public/weather-maps.json";
/* Camadas do GeoSampa liberadas para exibição (licença verificada em docs/fase-2/fontes.md). */
export const GEOSAMPA_ENABLED = {
    area_inundavel: { label: "Área inundável — PDMAT3, tempo de retorno de 100 anos", kind: "area" },
    risco_hidrologico: { label: "Área de risco hidrológico (enchente/inundação em assentamento precário)", kind: "area" },
    risco_ocorrencia_alagamento: { label: "Ocorrência de alagamento registrada", kind: "point" },
    risco_ocorrencia_inundacao: { label: "Ocorrência de inundação registrada", kind: "point" },
    reservatorio_amortecimento: { label: "Reservatório de amortecimento (piscinão)", kind: "area" },
};
async function getJson(url) {
    const resp = await fetch(url);
    if (!resp.ok)
        throw new Error(`HTTP ${resp.status} em ${url}`);
    return resp.json();
}
function bindToggle(key, layer, map, onFirstEnable) {
    const btn = document.querySelector(`.lp-row[data-layer="${key}"]`);
    if (!btn)
        return;
    btn.hidden = false;
    let loaded = !onFirstEnable;
    const apply = async (on) => {
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-checked", String(on));
        if (on && !loaded) {
            loaded = true;
            try {
                await onFirstEnable?.();
            }
            catch (err) {
                console.warn(err);
            }
        }
        if (on)
            map.addLayer(layer);
        else
            map.removeLayer(layer);
    };
    btn.addEventListener("click", () => apply(!btn.classList.contains("on")));
    if (btn.classList.contains("on"))
        apply(true);
}
function streetPopup(p) {
    return `<div class="pu ps"><div class="pu-name">${escapeHtml(p.name || p.group)}</div>
        <div class="ps-note"><strong>Via citada como alagável</strong> no roadmap do projeto (${escapeHtml(p.group)}).</div>
        <div class="ps-note">${escapeHtml(p.fonte_classificacao || "")}</div>
        <div class="pu-note">Geometria: © colaboradores do OpenStreetMap (ODbL).</div></div>`;
}
function waterPopup(p) {
    return `<div class="pu ps"><div class="pu-name">${escapeHtml(p.name || "Curso d'água sem nome")}</div>
        <div class="ps-note">${p.covered ? "Canalizado/tamponado (subterrâneo neste trecho)" : "A céu aberto"} · ${escapeHtml(p.kind || "")}</div>
        <div class="pu-note">© colaboradores do OpenStreetMap (ODbL).</div></div>`;
}
/** "2026-01-25Z" vira "25/01/2026" (datas do GeoSampa). */
function fmtDay(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(value || "");
}
function areaPopup(label, layerName, p) {
    const rows = [];
    if (p.nm_area_risco_hidrologico)
        rows.push(`Área: ${escapeHtml(p.nm_area_risco_hidrologico)}`);
    if (p.tx_grau_risco_hidrologico)
        rows.push(`Grau de risco: ${escapeHtml(p.tx_grau_risco_hidrologico)} (R1 baixo … R4 muito alto)`);
    if (p.tx_tipo_processo)
        rows.push(`Processo: ${escapeHtml(p.tx_tipo_processo.toLowerCase())}`);
    if (p.qt_moradia != null)
        rows.push(`${escapeHtml(p.qt_moradia)} moradia(s) no setor`);
    if (p.dt_vistoria)
        rows.push(`Vistoria: ${escapeHtml(fmtDay(p.dt_vistoria))}`);
    if (p.qt_tempo_retorno)
        rows.push(`Tempo de retorno: ${escapeHtml(p.qt_tempo_retorno)} anos`);
    if (p.nm_reservatorio)
        rows.push(`Reservatório: ${escapeHtml(p.nm_reservatorio)}${p.cd_reservatorio ? ` (${escapeHtml(p.cd_reservatorio)})` : ""}`);
    if (p.tx_tipo_esvaziamento)
        rows.push(`Esvaziamento: ${escapeHtml(p.tx_tipo_esvaziamento)}${/bomba/i.test(p.tx_tipo_esvaziamento) ? " — ponto de bombeamento" : ""}`);
    if (p.qt_volume_metro)
        rows.push(`Volume: ${escapeHtml(Number(p.qt_volume_metro).toLocaleString("pt-BR"))} m³`);
    if (p.tx_monitoramento_tempo_real)
        rows.push(`Monitoramento em tempo real: ${escapeHtml(p.tx_monitoramento_tempo_real)}`);
    return `<div class="pu ps"><div class="pu-name">${escapeHtml(label)}</div>
        ${rows.map(r => `<div class="ps-note">${r}</div>`).join("")}
        <div class="pu-note">Fonte: GeoSampa — Prefeitura de São Paulo (camada ${escapeHtml(layerName)}).</div></div>`;
}
const SUPPORT = {
    hospital: { symbol: "hospital", label: "Hospital" },
    fire_station: { symbol: "flame", label: "Corpo de Bombeiros" },
};
/** Centros aproximados dos distritos, a partir da grade H3 (média das células). */
function districtCentroids(hex) {
    const acc = {};
    for (const f of hex.features) {
        const p = f.properties;
        const ring = f.geometry.coordinates[0];
        const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        const a = acc[p.district] || (acc[p.district] = { lat: 0, lng: 0, n: 0, region: p.region });
        a.lat += lat;
        a.lng += lng;
        a.n += 1;
    }
    const out = {};
    for (const [name, a] of Object.entries(acc))
        out[name] = { lat: a.lat / a.n, lng: a.lng / a.n, region: a.region };
    return out;
}
/** Distrito citado num texto de notícia (nomes normalizados, palavra inteira). */
export function districtMentioned(text, names) {
    const t = ` ${normalizeName(text).replace(/[^A-Z0-9 ]/g, " ")} `;
    return names.filter(n => t.includes(` ${n} `));
}
export function initLayers(map) {
    /* ---------- cursos d'água ---------- */
    const water = L.geoJSON(null, {
        pane: "lines",
        style: f => ({ color: "#3B7DD8", weight: f?.properties.kind === "river" ? 3 : 1.6, opacity: 0.85, dashArray: f?.properties.covered ? "4 4" : undefined }),
        onEachFeature: (f, layer) => layer.bindPopup(waterPopup(f.properties), { maxWidth: 280 }),
    });
    bindToggle("waterways", water, map, async () => water.addData(await getJson(`${DATA}waterways.geojson`)));
    /* ---------- vias alagáveis ---------- */
    const streets = L.layerGroup();
    bindToggle("flood_streets", streets, map, async () => {
        const geo = await getJson(`${DATA}flood-streets.geojson`);
        L.geoJSON(geo, { pane: "lines", style: { color: "#1B1B1F", weight: 9, opacity: 0.55, lineCap: "round" }, interactive: false }).addTo(streets);
        L.geoJSON(geo, {
            pane: "lines",
            style: { color: "#8B5CF6", weight: 5, opacity: 0.95, lineCap: "round", className: "flood-street" },
            onEachFeature: (f, layer) => layer.bindPopup(streetPopup(f.properties), { maxWidth: 300 }),
        }).addTo(streets);
    });
    /* ---------- pontos de apoio ---------- */
    const support = clusterLayer(map, [], {
        iconFor: p => svgPin(SUPPORT[p.kind].symbol, p.kind),
        titleFor: p => `${SUPPORT[p.kind].label}: ${p.name || "sem nome"}`,
        popupFor: p => `<div class="pu ps"><div class="pu-name">${escapeHtml(p.name || SUPPORT[p.kind].label)}</div>
            <div class="ps-note">${SUPPORT[p.kind].label}</div>
            <div class="pu-note">© colaboradores do OpenStreetMap (ODbL) · ${escapeHtml(p.osm)}</div></div>`,
        clusterIcon: members => clusterPin(members, m => SUPPORT[m.kind].symbol),
    });
    bindToggle("support", support, map, async () => {
        const geo = await getJson(`${DATA}support-points.geojson`);
        support.setPoints(geo.features.filter(f => SUPPORT[f.properties.kind]).map(f => ({
            lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], kind: f.properties.kind,
            name: f.properties.name, osm: f.properties.osm,
        })));
    });
    /* ---------- GeoSampa: manchas e ocorrências ---------- */
    const geosampa = L.layerGroup();
    bindToggle("geosampa", geosampa, map, async () => {
        const meta = await getJson(`${DATA}metadata.json`);
        const available = meta.sources?.geosampa?.camadas || {};
        const occPoints = [];
        for (const [name, cfg] of Object.entries(GEOSAMPA_ENABLED)) {
            if (!available[`geoportal:${name}`])
                continue;
            const geo = await getJson(`${DATA}geosampa/${name}.geojson`);
            if (cfg.kind === "area") {
                L.geoJSON(geo, {
                    pane: "lines",
                    style: { color: "#2563EB", weight: 1, opacity: 0.8, fillColor: "#3B82F6", fillOpacity: 0.18, className: `gs-${name}` },
                    onEachFeature: (f, layer) => layer.bindPopup(areaPopup(cfg.label, name, f.properties)),
                }).addTo(geosampa);
            }
            else {
                for (const f of geo.features) {
                    const c = f.geometry && f.geometry.type === "Point" ? f.geometry.coordinates : null;
                    if (c)
                        occPoints.push({ lat: c[1], lng: c[0], kind: "occurrence", label: cfg.label, props: f.properties });
                }
            }
        }
        if (occPoints.length) {
            clusterLayer(map, occPoints, {
                iconFor: () => svgPin("droplet", "occurrence"),
                titleFor: p => `${p.label}${p.props?.dt_ocorrencia ? ` em ${fmtDay(p.props.dt_ocorrencia)}` : ""}`,
                popupFor: p => `<div class="pu ps"><div class="pu-name">${escapeHtml(p.label)}</div>
                    ${p.props?.dt_ocorrencia ? `<div class="ps-note">Data: ${escapeHtml(fmtDay(p.props.dt_ocorrencia))}</div>` : ""}
                    ${p.props?.nm_subprefeitura ? `<div class="ps-note">Subprefeitura: ${escapeHtml(p.props.nm_subprefeitura)}</div>` : ""}
                    <div class="pu-note">Fonte: GeoSampa — Prefeitura de São Paulo${p.props?.sg_fonte_original ? ` (registro ${escapeHtml(p.props.sg_fonte_original)})` : ""}.</div></div>`,
                clusterIcon: members => clusterPin(members, () => "droplet"),
            }).addTo(geosampa);
        }
    });
    /* ---------- notícias no mapa ---------- */
    const news = clusterLayer(map, [], {
        iconFor: () => svgPin("newspaper", "news"),
        titleFor: p => `Notícia: ${p.title}`,
        popupFor: p => `<div class="pu ps"><div class="pu-name">${escapeHtml(p.title)}</div>
            <div class="ps-note">${escapeHtml(p.source)} · ${timeAgo(p.when)}</div>
            <div class="ps-note">Localização aproximada: centro do distrito ${escapeHtml(p.district)}, citado na notícia.</div>
            ${/^https?:\/\//i.test(p.url || "") ? `<a class="pu-details" href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">Abrir notícia</a>` : ""}</div>`,
        clusterIcon: members => clusterPin(members, () => "newspaper"),
    });
    bindToggle("news_map", news, map, async () => {
        const [hex, data] = await Promise.all([getJson(`${DATA}hex-zona-norte.geojson`).catch(() => null), api.news()]);
        const centroids = hex ? districtCentroids(hex) : Object.fromEntries(Object.values(REGION_META).map(m => [normalizeName(m.short), m]));
        const names = Object.keys(centroids);
        const points = [];
        for (const a of data.articles || []) {
            for (const name of districtMentioned(`${a.title} ${a.summary || ""}`, names)) {
                const c = centroids[name];
                points.push({ lat: c.lat, lng: c.lng, kind: "news", title: stripEmoji(a.title), source: stripEmoji(a.source), url: a.url,
                    when: a.published_at || a.scraped_at, district: districtLabel(name) });
            }
        }
        news.setPoints(points);
        const btn = document.querySelector('.lp-row[data-layer="news_map"] small');
        if (btn)
            btn.textContent = points.length ? `${points.length} citando distritos` : "nenhuma cita distritos monitorados";
    });
    /* ---------- radar ---------- */
    const radar = L.layerGroup();
    bindToggle("radar", radar, map, async () => {
        const info = await getJson(RAINVIEWER);
        const frames = info.radar?.past || [];
        const last = frames[frames.length - 1];
        if (!last)
            throw new Error("RainViewer sem quadros");
        L.tileLayer(`${info.host}${last.path}/256/{z}/{x}/{y}/2/1_1.png`, {
            pane: "radar", opacity: 0.6, maxNativeZoom: 7, maxZoom: 19,
            attribution: 'Radar &copy; <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
        }).addTo(radar);
        const small = document.querySelector('.lp-row[data-layer="radar"] small');
        if (small)
            small.textContent = `RainViewer · ${fmtClock(last.time * 1000)}`;
    });
    $$(".lp-row[data-layer]").forEach(btn => btn.setAttribute("aria-checked", String(btn.classList.contains("on"))));
    return { water, streets, support, news, radar, geosampa };
}
