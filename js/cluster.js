/*
 * Agrupamento simples de marcadores por grade de pixels (sem plugin).
 * Pontos próximos na tela viram um "cluster" com contagem; clicar aproxima o mapa.
 */
export function clusterLayer(map, points, { iconFor, popupFor, titleFor, clusterIcon, gridPx = 56 }) {
    const group = L.layerGroup();
    function render() {
        group.clearLayers();
        const zoom = map.getZoom();
        const buckets = new Map();
        for (const p of points) {
            const px = map.project([p.lat, p.lng], zoom);
            const key = `${Math.floor(px.x / gridPx)}:${Math.floor(px.y / gridPx)}`;
            if (!buckets.has(key))
                buckets.set(key, []);
            buckets.get(key).push(p);
        }
        for (const members of buckets.values()) {
            if (members.length === 1 || zoom >= map.getMaxZoom()) {
                for (const p of members) {
                    L.marker([p.lat, p.lng], { icon: iconFor(p), title: titleFor(p), alt: titleFor(p), riseOnHover: true })
                        .bindPopup(() => popupFor(p), { maxWidth: 300 })
                        .addTo(group);
                }
                continue;
            }
            const lat = members.reduce((s, p) => s + p.lat, 0) / members.length;
            const lng = members.reduce((s, p) => s + p.lng, 0) / members.length;
            const bounds = L.latLngBounds(members.map(p => [p.lat, p.lng]));
            const label = `${members.length} itens agrupados — clique para aproximar`;
            L.marker([lat, lng], { icon: clusterIcon(members), title: label, alt: label })
                .on("click", () => {
                if (bounds.getNorthEast().equals(bounds.getSouthWest()))
                    map.setView(bounds.getCenter(), Math.min(zoom + 3, map.getMaxZoom()));
                else
                    map.fitBounds(bounds.pad(0.3), { maxZoom: Math.min(zoom + 4, map.getMaxZoom()) });
            })
                .addTo(group);
        }
    }
    group.on("add", () => { render(); map.on("zoomend", render); });
    group.on("remove", () => map.off("zoomend", render));
    group.setPoints = (next) => { points = next; if (map.hasLayer(group))
        render(); };
    return group;
}
/** Ícone de marcador com símbolo SVG do sprite. */
export function svgPin(symbol, kind, label = "") {
    return L.divIcon({
        className: `poi poi-${kind}`,
        html: `<span class="poi-badge"><svg class="i" aria-hidden="true"><use href="#i-${symbol}"></use></svg></span>${label}`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
    });
}
export function clusterPin(members, symbolFor) {
    const kinds = [...new Set(members.map(m => m.kind))];
    const symbol = kinds.length === 1 ? symbolFor(members[0]) : "layers";
    return L.divIcon({
        className: `poi poi-cluster ${kinds.length === 1 ? `poi-${kinds[0]}` : "poi-mixed"}`,
        html: `<span class="poi-badge"><svg class="i" aria-hidden="true"><use href="#i-${symbol}"></use></svg><b>${members.length}</b></span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
    });
}
