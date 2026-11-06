package br.sp.climasp.ops.routing;

import br.sp.climasp.ops.domain.LatLng;
import com.graphhopper.GHRequest;
import com.graphhopper.GHResponse;
import com.graphhopper.GraphHopper;
import com.graphhopper.ResponsePath;
import com.graphhopper.config.Profile;
import com.graphhopper.isochrone.algorithm.ShortestPathTree;
import com.graphhopper.routing.ev.Subnetwork;
import com.graphhopper.routing.querygraph.QueryGraph;
import com.graphhopper.routing.util.DefaultSnapFilter;
import com.graphhopper.routing.util.TraversalMode;
import com.graphhopper.routing.weighting.Weighting;
import com.graphhopper.storage.index.Snap;
import com.graphhopper.util.GHUtility;
import com.graphhopper.util.PMap;
import com.graphhopper.util.PointList;
import com.graphhopper.util.Parameters;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * GraphHopper embutido no processo: lê um extrato do OpenStreetMap (.osm.pbf da região, ex.:
 * Geofabrik "sudeste"), monta o grafo de carro uma vez (cache em disco) e responde rotas e
 * árvores de menor caminho (isócronas) sem serviço externo. Pontos fora da malha caem na
 * estimativa em linha reta, rotulada.
 */
public class GraphHopperRouter implements TravelRouter, AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(GraphHopperRouter.class);
    static final String PROFILE = "car";
    /** Pontos a mais que isso da via mais próxima não são roteáveis (m). */
    static final double MAX_SNAP_METERS = 1000;

    private final GraphHopper hopper;
    private final EstimateRouter fallback = new EstimateRouter();

    public GraphHopperRouter(String osmFile, String cacheDir) {
        Profile car = new Profile(PROFILE).setCustomModel(GHUtility.loadCustomModelFromJar("car.json"));
        hopper = new GraphHopper()
                .setOSMFile(osmFile)
                .setGraphHopperLocation(cacheDir)
                .setEncodedValuesString("car_access, car_average_speed, road_access")
                .setProfiles(car)
                .setMinNetworkSize(10);
        long t0 = System.currentTimeMillis();
        hopper.importOrLoad();
        log.info("GraphHopper pronto ({} ms): {} nós, arquivo {}", System.currentTimeMillis() - t0,
                hopper.getBaseGraph().getNodes(), osmFile);
    }

    @Override
    public String name() {
        return "graphhopper";
    }

    private GHResponse route(LatLng from, LatLng to, boolean alternatives) {
        GHRequest req = new GHRequest(from.lat(), from.lng(), to.lat(), to.lng()).setProfile(PROFILE).setLocale(Locale.ROOT);
        if (alternatives) {
            req.setAlgorithm(Parameters.Algorithms.ALT_ROUTE);
            req.getHints().putObject("alternative_route.max_paths", 3);
        }
        return hopper.route(req);
    }

    @Override
    public TravelTimes minutesTo(List<LatLng> origins, LatLng destination) {
        List<Double> out = new ArrayList<>(origins.size());
        boolean estimated = false;
        for (LatLng o : origins) {
            GHResponse r = route(o, destination, false);
            if (r.hasErrors()) {
                out.add(EstimateRouter.estimateMinutes(o, destination));
                estimated = true;
            } else {
                out.add(r.getBest().getTime() / 60000.0);
            }
        }
        return new TravelTimes(out, estimated, name());
    }

    @Override
    public List<Route> routes(LatLng from, LatLng to) {
        GHResponse r = route(from, to, true);
        if (r.hasErrors()) {
            log.warn("GraphHopper sem rota ({}); linha reta estimada.", r.getErrors());
            return fallback.routes(from, to);
        }
        List<Route> out = new ArrayList<>();
        for (ResponsePath p : r.getAll()) {
            PointList pts = p.getPoints();
            List<double[]> coords = new ArrayList<>(pts.size());
            for (int i = 0; i < pts.size(); i++) coords.add(new double[] {pts.getLat(i), pts.getLon(i)});
            out.add(new Route(p.getTime() / 60000.0, p.getDistance() / 1000, coords, false));
        }
        out.sort((a, b) -> Double.compare(a.minutes(), b.minutes()));
        return out;
    }

    /**
     * Isócronas: uma árvore de menor caminho a partir da origem (limite de tempo) dá o tempo até
     * todos os nós; cada ponto usa o nó da via mais próxima. Uma busca por base, não uma por célula.
     */
    @Override
    public TravelTimes minutesFrom(LatLng origin, List<LatLng> points, double maxMinutes) {
        Weighting weighting = hopper.createWeighting(hopper.getProfile(PROFILE), new PMap());
        var snapFilter = new DefaultSnapFilter(weighting,
                hopper.getEncodingManager().getBooleanEncodedValue(Subnetwork.key(PROFILE)));
        Snap start = hopper.getLocationIndex().findClosest(origin.lat(), origin.lng(), snapFilter);
        if (!start.isValid() || start.getQueryDistance() > MAX_SNAP_METERS) return fallback.minutesFrom(origin, points, maxMinutes);
        QueryGraph graph = QueryGraph.create(hopper.getBaseGraph(), start);
        ShortestPathTree tree = new ShortestPathTree(graph, graph.wrapWeighting(weighting), false, TraversalMode.NODE_BASED);
        tree.setTimeLimit(maxMinutes * 60_000);
        Map<Integer, Long> timeByNode = new HashMap<>();
        tree.search(start.getClosestNode(), label -> timeByNode.merge(label.node, label.time, Math::min));

        List<Double> out = new ArrayList<>(points.size());
        for (LatLng p : points) {
            Snap s = hopper.getLocationIndex().findClosest(p.lat(), p.lng(), snapFilter);
            Long ms = s.isValid() && s.getQueryDistance() <= MAX_SNAP_METERS ? timeByNode.get(s.getClosestNode()) : null;
            out.add(ms == null ? null : ms / 60000.0);
        }
        return new TravelTimes(out, false, name());
    }

    @Override
    public void close() {
        hopper.close();
    }
}
