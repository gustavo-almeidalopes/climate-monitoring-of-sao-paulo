package br.sp.climasp.ops.service;

import br.sp.climasp.ops.domain.LatLng;
import br.sp.climasp.ops.domain.Team;
import br.sp.climasp.ops.repo.GeoRepository.Cell;
import br.sp.climasp.ops.repo.TeamRepository;
import br.sp.climasp.ops.routing.TravelRouter;
import br.sp.climasp.ops.routing.TravelRouter.Route;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Despacho e cobertura no servidor: equipes mais rápidas por tempo de chegada (ruas) e
 * isócronas a partir das bases. O motor de rotas vem de {@link br.sp.climasp.ops.routing.RoutingConfig}.
 */
@Service
public class DispatchService {

    private final TeamRepository teams;
    private final GeoService geo;
    private final TravelRouter router;

    public DispatchService(TeamRepository teams, GeoService geo, TravelRouter router) {
        this.teams = teams;
        this.geo = geo;
        this.router = router;
    }

    public record Candidate(Team team, double minutes, List<Route> routes, boolean estimated) {
    }

    public record Nearest(String source, boolean estimated, List<Candidate> candidates) {
    }

    /**
     * Equipes disponíveis (do tipo, se informado) ordenadas pelo tempo de chegada até o ponto;
     * as `limit` primeiras trazem as rotas (com alternativas) para o front escolher a que evita
     * zonas críticas.
     */
    public Nearest nearest(double lat, double lng, int limit, String kind) {
        LatLng target = new LatLng(lat, lng);
        List<Team> free = teams.findAll().stream()
                .filter(t -> t.status().equals("disponivel"))
                .filter(t -> kind == null || kind.isBlank() || kind.equals("todas") || t.kind().equals(kind))
                .toList();
        if (free.isEmpty()) return new Nearest(router.name(), false, List.of());
        var times = router.minutesTo(free.stream().map(Team::position).toList(), target);
        record Ranked(Team team, Double minutes) {
        }
        List<Ranked> ranked = new ArrayList<>();
        for (int i = 0; i < free.size(); i++) if (times.minutes().get(i) != null) ranked.add(new Ranked(free.get(i), times.minutes().get(i)));
        ranked.sort(Comparator.comparingDouble(Ranked::minutes));
        List<Candidate> out = new ArrayList<>();
        for (Ranked r : ranked.subList(0, Math.min(limit, ranked.size()))) {
            List<Route> routes = router.routes(r.team().position(), target);
            boolean estimated = times.estimated() || routes.stream().allMatch(Route::estimated);
            double minutes = routes.isEmpty() ? r.minutes() : routes.get(0).minutes();
            out.add(new Candidate(r.team(), minutes, routes, estimated));
        }
        out.sort(Comparator.comparingDouble(Candidate::minutes));
        return new Nearest(times.source(), times.estimated(), out);
    }

    /**
     * Menor tempo (min) de qualquer base com equipe do tipo até o centro de cada célula H3.
     * Mesma forma do data/geo/coverage.json pré-calculado (cells + minutos), agora ao vivo.
     */
    public Map<String, Object> coverage(String kind, double maxMinutes) {
        List<Cell> cells = geo.cells();
        List<LatLng> points = cells.stream().map(c -> new LatLng(c.lat(), c.lng())).toList();
        Map<String, LatLng> bases = new LinkedHashMap<>();
        for (Team t : teams.findAll()) {
            if (kind == null || kind.isBlank() || kind.equals("todas") || t.kind().equals(kind)) {
                bases.putIfAbsent(String.format(java.util.Locale.ROOT, "%.5f,%.5f", t.baseLat(), t.baseLng()),
                        new LatLng(t.baseLat(), t.baseLng()));
            }
        }
        Double[] best = new Double[points.size()];
        boolean estimated = false;
        String source = router.name();
        for (LatLng base : bases.values()) {
            var t = router.minutesFrom(base, points, maxMinutes);
            estimated |= t.estimated();
            source = t.source();
            for (int i = 0; i < best.length; i++) {
                Double m = t.minutes().get(i);
                if (m != null && (best[i] == null || m < best[i])) best[i] = m;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", source);
        out.put("estimated", estimated);
        out.put("kind", kind == null || kind.isBlank() ? "todas" : kind);
        out.put("max_minutes", maxMinutes);
        out.put("bases", bases.size());
        out.put("cells", cells.stream().map(Cell::h3).toList());
        out.put("minutes", java.util.Arrays.stream(best).map(m -> m == null ? null : Math.round(m * 10) / 10.0).toList());
        return out;
    }
}
