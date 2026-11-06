package br.sp.climasp.ops.service;

import br.sp.climasp.ops.config.OpsProperties;
import br.sp.climasp.ops.repo.TeamRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Na subida: importa as camadas geográficas e, se não houver equipes, semeia as equipes de
 * EXEMPLO (fictícias) de data/geo/example-teams.json — o mesmo conjunto do backend Python.
 */
@Component
public class SeedService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SeedService.class);

    private final OpsProperties props;
    private final TeamRepository teams;
    private final GeoService geo;
    private final ObjectMapper json;

    public SeedService(OpsProperties props, TeamRepository teams, GeoService geo, ObjectMapper json) {
        this.props = props;
        this.teams = teams;
        this.geo = geo;
        this.json = json;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        geo.importIfEmpty();
        seedTeams();
    }

    @Transactional
    public int seedTeams() throws java.io.IOException {
        if (!props.seedExamples() || teams.count() > 0) return 0;
        Path file = Path.of(props.geoDataDir()).resolve("example-teams.json");
        if (!Files.exists(file)) {
            log.warn("Sem {} — nenhuma equipe de exemplo semeada.", file);
            return 0;
        }
        int n = 0;
        for (JsonNode t : json.readTree(file.toFile()).path("teams")) {
            String name = t.path("name").asText();
            if (!name.startsWith("[EXEMPLO]")) throw new IllegalStateException("Equipe de exemplo sem rótulo [EXEMPLO]: " + name);
            teams.insert(t.path("code").asText(), name, t.path("kind").asText(), t.path("base_name").asText(),
                    t.path("base_source").asText(), t.path("lat").asDouble(), t.path("lng").asDouble());
            n++;
        }
        log.info("{} equipes de EXEMPLO (fictícias) semeadas de {}", n, file);
        return n;
    }
}
