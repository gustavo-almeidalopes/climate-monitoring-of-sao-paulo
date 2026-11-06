package br.sp.climasp.ops.repo;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Camadas geográficas no PostGIS: grade H3 da Zona Norte e polígonos oficiais do GeoSampa. */
@Repository
public class GeoRepository {

    private final JdbcClient db;

    public GeoRepository(JdbcClient db) {
        this.db = db;
    }

    public record Cell(String h3, String region, String district, Double susc, String props, double lat, double lng) {
    }

    public record Area(String layer, String name, String props) {
    }

    public long countCells() {
        return db.sql("SELECT count(*) FROM geo_cells").query(Long.class).single();
    }

    public long countAreas() {
        return db.sql("SELECT count(*) FROM geo_areas").query(Long.class).single();
    }

    public void insertCell(String h3, String region, String district, Double susc, String propsJson, String geometryJson) {
        db.sql("""
                INSERT INTO geo_cells (h3, region, district, susc, props, geom, center)
                SELECT :h3, :region, :district, :susc, CAST(:props AS jsonb), g, ST_Centroid(g)::geography
                  FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326) AS g) s
                ON CONFLICT (h3) DO NOTHING""")
                .param("h3", h3).param("region", region).param("district", district).param("susc", susc)
                .param("props", propsJson).param("geom", geometryJson).update();
    }

    public void insertArea(String layer, String name, String propsJson, String geometryJson) {
        db.sql("""
                INSERT INTO geo_areas (layer, name, props, geom)
                VALUES (:layer, :name, CAST(:props AS jsonb),
                        ST_Multi(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326)), 3)))""")
                .param("layer", layer).param("name", name).param("props", propsJson).param("geom", geometryJson).update();
    }

    private static final String CELL_COLUMNS =
            "h3, region, district, susc, props::text AS props, ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng";

    private static Cell mapCell(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Cell(rs.getString("h3"), rs.getString("region"), rs.getString("district"),
                (Double) rs.getObject("susc"), rs.getString("props"), rs.getDouble("lat"), rs.getDouble("lng"));
    }

    /** Célula que contém o ponto. */
    public Optional<Cell> cellContaining(double lat, double lng) {
        return db.sql("SELECT " + CELL_COLUMNS + " FROM geo_cells WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)) LIMIT 1")
                .param("lat", lat).param("lng", lng).query(GeoRepository::mapCell).optional();
    }

    /** Célula de centro mais próximo dentro de `meters` — mesma regra do region_at do Python (450 m). */
    public Optional<Cell> nearestCell(double lat, double lng, double meters) {
        return db.sql("SELECT " + CELL_COLUMNS + """
                         FROM geo_cells
                        WHERE ST_DWithin(center, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :m)
                        ORDER BY center <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                        LIMIT 1""")
                .param("lat", lat).param("lng", lng).param("m", meters).query(GeoRepository::mapCell).optional();
    }

    public List<Cell> allCells() {
        return db.sql("SELECT " + CELL_COLUMNS + " FROM geo_cells ORDER BY h3").query(GeoRepository::mapCell).list();
    }

    /** Polígonos oficiais (área inundável, risco hidrológico) que contêm o ponto. */
    public List<Area> areasContaining(double lat, double lng) {
        return db.sql("""
                SELECT layer, name, props::text AS props FROM geo_areas
                 WHERE ST_Covers(geom, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326))
                 ORDER BY layer, name""")
                .param("lat", lat).param("lng", lng)
                .query((rs, i) -> new Area(rs.getString("layer"), rs.getString("name"), rs.getString("props"))).list();
    }

    /** Distância (m) até o polígono de área inundável mais próximo, se houver algum até `meters`. */
    public Optional<Map<String, Object>> nearestArea(double lat, double lng, String layer, double meters) {
        return db.sql("""
                SELECT name, round(ST_Distance(geom::geography, p)::numeric, 0) AS meters
                  FROM geo_areas, (SELECT ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography AS p) q
                 WHERE layer = :layer AND ST_DWithin(geom::geography, p, :m)
                 ORDER BY geom::geography <-> p LIMIT 1""")
                .param("lat", lat).param("lng", lng).param("layer", layer).param("m", meters)
                .query((rs, i) -> Map.<String, Object>of("name", rs.getString("name") == null ? "" : rs.getString("name"),
                        "meters", rs.getBigDecimal("meters").doubleValue()))
                .optional();
    }
}
