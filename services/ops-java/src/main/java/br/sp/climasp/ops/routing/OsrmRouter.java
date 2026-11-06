package br.sp.climasp.ops.routing;

import br.sp.climasp.ops.domain.LatLng;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/** OSRM por HTTP (servidor próprio recomendado). Se falhar, estimativa em linha reta, rotulada. */
public class OsrmRouter implements TravelRouter {

    private static final Logger log = LoggerFactory.getLogger(OsrmRouter.class);

    private final RestClient http;
    private final EstimateRouter fallback = new EstimateRouter();

    public OsrmRouter(String baseUrl) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(12));
        this.http = RestClient.builder().baseUrl(baseUrl.replaceAll("/$", "")).requestFactory(factory).build();
    }

    @Override
    public String name() {
        return "osrm";
    }

    private static String coord(LatLng p) {
        return String.format(Locale.ROOT, "%.5f,%.5f", p.lng(), p.lat());
    }

    @Override
    public TravelTimes minutesTo(List<LatLng> origins, LatLng destination) {
        if (origins.isEmpty()) return new TravelTimes(List.of(), false, name());
        try {
            List<LatLng> all = new ArrayList<>(origins);
            all.add(destination);
            String coords = all.stream().map(OsrmRouter::coord).collect(Collectors.joining(";"));
            String sources = IntStream.range(0, origins.size()).mapToObj(String::valueOf).collect(Collectors.joining(";"));
            JsonNode data = http.get().uri("/table/v1/driving/" + coords + "?sources=" + sources
                    + "&destinations=" + origins.size() + "&annotations=duration").retrieve().body(JsonNode.class);
            if (data == null || !"Ok".equals(data.path("code").asText())) throw new IllegalStateException("OSRM " + data);
            List<Double> minutes = new ArrayList<>();
            for (JsonNode row : data.path("durations")) minutes.add(row.get(0).isNull() ? null : row.get(0).asDouble() / 60);
            return new TravelTimes(minutes, false, name());
        } catch (RuntimeException e) {
            log.warn("OSRM indisponível; usando estimativa em linha reta: {}", e.toString());
            return fallback.minutesTo(origins, destination);
        }
    }

    @Override
    public List<Route> routes(LatLng from, LatLng to) {
        try {
            JsonNode data = http.get().uri("/route/v1/driving/" + coord(from) + ";" + coord(to)
                    + "?alternatives=true&overview=full&geometries=geojson").retrieve().body(JsonNode.class);
            if (data == null || !"Ok".equals(data.path("code").asText())) throw new IllegalStateException("OSRM " + data);
            List<Route> out = new ArrayList<>();
            for (JsonNode r : data.path("routes")) {
                List<double[]> coords = new ArrayList<>();
                for (JsonNode c : r.path("geometry").path("coordinates")) coords.add(new double[] {c.get(1).asDouble(), c.get(0).asDouble()});
                out.add(new Route(r.path("duration").asDouble() / 60, r.path("distance").asDouble() / 1000, coords, false));
            }
            return out;
        } catch (RuntimeException e) {
            log.warn("OSRM indisponível para rota; linha reta estimada: {}", e.toString());
            return fallback.routes(from, to);
        }
    }
}
