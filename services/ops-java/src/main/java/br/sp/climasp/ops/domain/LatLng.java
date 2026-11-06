package br.sp.climasp.ops.domain;

/** Coordenada WGS 84 (graus). */
public record LatLng(double lat, double lng) {

    /** Distância em linha reta (km), fórmula de haversine — igual à do front-end. */
    public double kmTo(LatLng o) {
        double r = Math.PI / 180;
        double dLat = (o.lat - lat) * r;
        double dLng = (o.lng - lng) * r;
        double a = Math.pow(Math.sin(dLat / 2), 2)
                + Math.cos(lat * r) * Math.cos(o.lat * r) * Math.pow(Math.sin(dLng / 2), 2);
        return 6371 * 2 * Math.asin(Math.sqrt(a));
    }
}
