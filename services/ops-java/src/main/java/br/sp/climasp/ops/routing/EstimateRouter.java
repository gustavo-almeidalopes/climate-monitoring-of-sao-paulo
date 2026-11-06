package br.sp.climasp.ops.routing;

import br.sp.climasp.ops.domain.LatLng;
import java.util.List;

/**
 * Estimativa em linha reta: distância × 1,4 (ruas não são retas) a 25 km/h — a mesma fórmula
 * do front-end (src/routing.ts), para os números baterem. Sempre rotulada como estimativa.
 */
public class EstimateRouter implements TravelRouter {

    static final double FALLBACK_KMH = 25;
    static final double DETOUR_FACTOR = 1.4;

    public static double estimateMinutes(LatLng from, LatLng to) {
        return from.kmTo(to) * DETOUR_FACTOR / FALLBACK_KMH * 60;
    }

    @Override
    public String name() {
        return "estimativa";
    }

    @Override
    public TravelTimes minutesTo(List<LatLng> origins, LatLng destination) {
        return new TravelTimes(origins.stream().map(o -> (Double) estimateMinutes(o, destination)).toList(), true, name());
    }

    @Override
    public List<Route> routes(LatLng from, LatLng to) {
        return List.of(new Route(estimateMinutes(from, to), from.kmTo(to),
                List.of(new double[] {from.lat(), from.lng()}, new double[] {to.lat(), to.lng()}), true));
    }

    @Override
    public TravelTimes minutesFrom(LatLng origin, List<LatLng> points, double maxMinutes) {
        return new TravelTimes(points.stream().map(p -> {
            double m = estimateMinutes(origin, p);
            return m <= maxMinutes ? (Double) m : null;
        }).toList(), true, name());
    }
}
