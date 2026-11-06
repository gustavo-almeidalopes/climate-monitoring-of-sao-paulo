/*
 * Agrupamento simples de marcadores por grade de pixels (sem plugin).
 * Pontos próximos na tela viram um "cluster" com contagem; clicar aproxima o mapa.
 */

export interface ClusterPoint {
    lat: number;
    lng: number;
    kind: string;
    [key: string]: any;
}

export interface ClusterOptions<P extends ClusterPoint> {
    iconFor: (p: P) => L.DivIcon;
    popupFor: (p: P) => string;
    titleFor: (p: P) => string;
    clusterIcon: (members: P[]) => L.DivIcon;
    gridPx?: number;
}

/** Camada com `setPoints` para trocar os pontos sem recriar a camada. */
export type ClusterLayer<P extends ClusterPoint> = L.LayerGroup & { setPoints(next: P[]): void };

export function clusterLayer<P extends ClusterPoint>(map: L.Map, points: P[], { iconFor, popupFor, titleFor, clusterIcon, gridPx = 56 }: ClusterOptions<P>): ClusterLayer<P> {
    const group = L.layerGroup() as ClusterLayer<P>;

    function render() {
        group.clearLayers();
        const zoom = map.getZoom();
        const buckets = new Map<string, P[]>();
        for (const p of points) {
            const px = map.project([p.lat, p.lng], zoom);
            const key = `${Math.floor(px.x / gridPx)}:${Math.floor(px.y / gridPx)}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key)!.push(p);
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
            const bounds = L.latLngBounds(members.map(p => [p.lat, p.lng] as [number, number]));
            const label = `${members.length} itens agrupados — clique para aproximar`;
            L.marker([lat, lng], { icon: clusterIcon(members), title: label, alt: label })
                .on("click", () => {
                    if (bounds.getNorthEast().equals(bounds.getSouthWest())) map.setView(bounds.getCenter(), Math.min(zoom + 3, map.getMaxZoom()));
                    else map.fitBounds(bounds.pad(0.3), { maxZoom: Math.min(zoom + 4, map.getMaxZoom()) });
                })
                .addTo(group);
        }
    }

    group.on("add", () => { render(); map.on("zoomend", render); });
    group.on("remove", () => map.off("zoomend", render));
    group.setPoints = (next: P[]) => { points = next; if (map.hasLayer(group)) render(); };
    return group;
}

/** Ícone de marcador com símbolo SVG do sprite. */
export function svgPin(symbol: string, kind: string, label = ""): L.DivIcon {
    return L.divIcon({
        className: `poi poi-${kind}`,
        html: `<span class="poi-badge"><svg class="i" aria-hidden="true"><use href="#i-${symbol}"></use></svg></span>${label}`,
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -14],
    });
}

export function clusterPin<P extends ClusterPoint>(members: P[], symbolFor: (p: P) => string): L.DivIcon {
    const kinds = [...new Set(members.map(m => m.kind))];
    const symbol = kinds.length === 1 ? symbolFor(members[0]) : "layers";
    return L.divIcon({
        className: `poi poi-cluster ${kinds.length === 1 ? `poi-${kinds[0]}` : "poi-mixed"}`,
        html: `<span class="poi-badge"><svg class="i" aria-hidden="true"><use href="#i-${symbol}"></use></svg><b>${members.length}</b></span>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
    });
}
