package br.sp.climasp.ops.service;

import br.sp.climasp.ops.config.OpsProperties;
import br.sp.climasp.ops.repo.GeoRepository;
import br.sp.climasp.ops.repo.GeoRepository.Cell;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Consultas geográficas em PostGIS. Na primeira subida, carrega os arquivos versionados em
 * data/geo/ (grade H3 e polígonos do GeoSampa) — as mesmas fontes que o mapa usa, sem dado novo.
 */
@Service
public class GeoService {

    private static final Logger log = LoggerFactory.getLogger(GeoService.class);

    /** Camadas do GeoSampa com polígonos que respondem "este ponto está em área de risco?". */
    static final Map<String, String> AREA_LAYERS = Map.of(
            "area_inundavel", "cd_identificador_area_inundavel",
            "risco_hidrologico", "nm_area_risco_hidrologico");

    private final GeoRepository repo;
    private final OpsProperties props;
    private final ObjectMapper json;

    public GeoService(GeoRepository repo, OpsProperties props, ObjectMapper json) {
        this.repo = repo;
        this.props = props;
        this.json = json;
    }

    Path dataDir() {
        return Path.of(props.geoDataDir());
    }

    /** Importa a grade e as áreas se as tabelas estiverem vazias. Devolve {cells, areas} importados. */
    @Transactional
    public Map<String, Integer> importIfEmpty() throws IOException {
        int cells = 0, areas = 0;
        Path hex = dataDir().resolve("hex-zona-norte.geojson");
        if (repo.countCells() == 0 && Files.exists(hex)) {
            for (JsonNode f : json.readTree(hex.toFile()).path("features")) {
                JsonNode p = f.path("properties");
                Double susc = p.path("susc").isNumber() ? p.path("susc").asDouble() : null;
                repo.insertCell(p.path("h3").asText(), p.path("region").asText(), p.path("district").asText(), susc,
                        json.writeValueAsString(p), json.writeValueAsString(f.path("geometry")));
                cells++;
            }
        }
        if (repo.countAreas() == 0) {
            for (var layer : AREA_LAYERS.entrySet()) {
                Path file = dataDir().resolve("geosampa").resolve(layer.getKey() + ".geojson");
                if (!Files.exists(file)) continue;
                for (JsonNode f : json.readTree(file.toFile()).path("features")) {
                    JsonNode p = f.path("properties");
                    String name = p.path(layer.getValue()).asText("");
                    repo.insertArea(layer.getKey(), name, json.writeValueAsString(p), json.writeValueAsString(f.path("geometry")));
                    areas++;
                }
            }
        }
        if (cells + areas > 0) log.info("PostGIS: {} células H3 e {} polígonos do GeoSampa importados de {}", cells, areas, dataDir());
        return Map.of("cells", cells, "areas", areas);
    }

    /** Região (subprefeitura) de um ponto — célula de centro mais próximo até 450 m, como no Python. */
    public String regionAt(double lat, double lng) {
        return repo.nearestCell(lat, lng, 450).map(Cell::region).orElse(null);
    }

    public List<Cell> cells() {
        return repo.allCells();
    }

    /** Resposta de GET /api/v1/geo/point: célula, região, distrito e áreas oficiais de risco no ponto. */
    public Map<String, Object> pointInfo(double lat, double lng) throws IOException {
        Optional<Cell> cell = repo.cellContaining(lat, lng).or(() -> repo.nearestCell(lat, lng, 450));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("lat", lat);
        out.put("lng", lng);
        out.put("inside", cell.isPresent());
        out.put("region", cell.map(Cell::region).orElse(null));
        out.put("district", cell.map(Cell::district).orElse(null));
        out.put("cell", cell.isPresent() ? json.readTree(cell.get().props()) : null);
        var areas = repo.areasContaining(lat, lng);
        out.put("official_areas", areas.stream().map(a -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("layer", a.layer());
            m.put("name", a.name());
            try {
                m.put("properties", json.readTree(a.props()));
            } catch (IOException e) {
                m.put("properties", null);
            }
            return m;
        }).toList());
        out.put("in_flood_area", areas.stream().anyMatch(a -> a.layer().equals("area_inundavel")));
        out.put("nearest_flood_area", repo.nearestArea(lat, lng, "area_inundavel", 2000).orElse(null));
        out.put("sources", List.of(
                "Grade H3 (relevo Copernicus/SRTM, cursos d'água OSM, ocorrências GeoSampa) — data/geo/metadata.json",
                "GeoSampa (Prefeitura de São Paulo): área inundável e risco hidrológico"));
        return out;
    }
}
