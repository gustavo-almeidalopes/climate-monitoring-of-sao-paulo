package br.sp.climasp.ops.routing;

import br.sp.climasp.ops.domain.LatLng;
import java.util.ArrayList;
import java.util.List;

/**
 * Tempo de chegada por ruas (carro, sem trânsito). Implementações: GraphHopper embutido,
 * OSRM por HTTP e estimativa em linha reta — esta última sempre marcada como estimada.
 */
public interface TravelRouter {

    /** "graphhopper", "osrm" ou "estimativa". */
    String name();

    /** Minutos de cada origem até o destino (null = sem rota). */
    TravelTimes minutesTo(List<LatLng> origins, LatLng destination);

    /** Rotas de `from` até `to`, a mais rápida primeiro (com alternativas, quando o motor oferece). */
    List<Route> routes(LatLng from, LatLng to);

    /** Minutos de uma origem até cada ponto (isócronas). Padrão: uma consulta por ponto. */
    default TravelTimes minutesFrom(LatLng origin, List<LatLng> points, double maxMinutes) {
        List<Double> out = new ArrayList<>(points.size());
        boolean estimated = false;
        for (LatLng p : points) {
            TravelTimes t = minutesTo(List.of(origin), p);
            Double m = t.minutes().get(0);
            out.add(m != null && m <= maxMinutes ? m : null);
            estimated |= t.estimated();
        }
        return new TravelTimes(out, estimated, name());
    }

    record TravelTimes(List<Double> minutes, boolean estimated, String source) {
    }

    /** coords em [lat, lng], como o front-end desenha. */
    record Route(double minutes, double km, List<double[]> coords, boolean estimated) {
    }
}
