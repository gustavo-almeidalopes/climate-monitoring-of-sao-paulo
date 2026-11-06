package br.sp.climasp.ops.routing;

import br.sp.climasp.ops.config.OpsProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Escolhe o motor de rotas. ROUTING_ENGINE=auto (padrão): GraphHopper se OSM_FILE existir,
 * senão OSRM se OSRM_URL estiver definido, senão estimativa em linha reta.
 */
@Configuration
public class RoutingConfig {

    private static final Logger log = LoggerFactory.getLogger(RoutingConfig.class);

    @Bean(destroyMethod = "")
    TravelRouter travelRouter(OpsProperties props) {
        var r = props.routing();
        String engine = r == null || r.engine() == null ? "auto" : r.engine();
        String osm = r == null ? null : r.osmFile();
        String osrm = r == null ? null : r.osrmUrl();
        boolean hasOsm = osm != null && !osm.isBlank() && Files.exists(Path.of(osm));
        boolean hasOsrm = osrm != null && !osrm.isBlank();
        TravelRouter router = switch (engine) {
            case "graphhopper" -> {
                if (!hasOsm) throw new IllegalStateException("ROUTING_ENGINE=graphhopper exige OSM_FILE existente: " + osm);
                yield new GraphHopperRouter(osm, r.graphCacheDir());
            }
            case "osrm" -> {
                if (!hasOsrm) throw new IllegalStateException("ROUTING_ENGINE=osrm exige OSRM_URL.");
                yield new OsrmRouter(osrm);
            }
            case "estimativa", "estimate" -> new EstimateRouter();
            default -> hasOsm ? new GraphHopperRouter(osm, r.graphCacheDir()) : hasOsrm ? new OsrmRouter(osrm) : new EstimateRouter();
        };
        log.info("Motor de rotas: {}", router.name());
        return router;
    }
}
