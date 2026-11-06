/*
 * Globais da página: Leaflet vem de <script> (unpkg, com SRI) e config.js define as
 * configurações em window. Os módulos usam `L` como global, sem import; os tipos do
 * Leaflet ficam acessíveis como `L.Marker`, `L.LayerGroup` etc.
 */
import type * as Leaflet from "leaflet";

declare global {
    const L: typeof Leaflet;
    namespace L {
        type Circle = Leaflet.Circle;
        type CircleMarker = Leaflet.CircleMarker;
        type DivIcon = Leaflet.DivIcon;
        type GeoJSON = Leaflet.GeoJSON;
        type GeoJSONOptions = Leaflet.GeoJSONOptions;
        type PopupOptions = Leaflet.PopupOptions;
        type LatLng = Leaflet.LatLng;
        type LatLngBounds = Leaflet.LatLngBounds;
        type LatLngExpression = Leaflet.LatLngExpression;
        type Layer = Leaflet.Layer;
        type LayerGroup = Leaflet.LayerGroup;
        type Map = Leaflet.Map;
        type Marker = Leaflet.Marker;
        type Path = Leaflet.Path;
        type PathOptions = Leaflet.PathOptions;
        type Polyline = Leaflet.Polyline;
        type TileLayer = Leaflet.TileLayer;
    }

    interface Window {
        CLIMASP_API_BASE?: string;
        CLIMASP_OSRM_URL?: string;
        CLIMASP_DEV_LOG?: boolean;
    }
}

export {};
