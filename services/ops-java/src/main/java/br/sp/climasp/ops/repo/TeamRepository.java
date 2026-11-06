package br.sp.climasp.ops.repo;

import br.sp.climasp.ops.domain.Team;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Equipes em PostGIS (posições em geography). */
@Repository
public class TeamRepository {

    private static final String COLUMNS = """
            id, code, name, kind, status, ST_Y(position::geometry) AS lat, ST_X(position::geometry) AS lng,
            base_name, base_source, ST_Y(base::geometry) AS base_lat, ST_X(base::geometry) AS base_lng,
            is_example, updated_at""";

    private final JdbcClient db;

    public TeamRepository(JdbcClient db) {
        this.db = db;
    }

    static Team map(ResultSet rs, int i) throws SQLException {
        return new Team(rs.getInt("id"), rs.getString("code"), rs.getString("name"), rs.getString("kind"),
                rs.getString("status"), rs.getDouble("lat"), rs.getDouble("lng"), rs.getString("base_name"),
                rs.getString("base_source"), rs.getDouble("base_lat"), rs.getDouble("base_lng"),
                rs.getBoolean("is_example"), rs.getObject("updated_at", OffsetDateTime.class));
    }

    public List<Team> findAll() {
        return db.sql("SELECT " + COLUMNS + " FROM ops_teams ORDER BY kind, id").query(TeamRepository::map).list();
    }

    public Optional<Team> findById(int id) {
        return db.sql("SELECT " + COLUMNS + " FROM ops_teams WHERE id = ?").param(id).query(TeamRepository::map).optional();
    }

    /** Para alterar status com segurança em despachos concorrentes. */
    public Optional<Team> lockById(int id) {
        return db.sql("SELECT " + COLUMNS + " FROM ops_teams WHERE id = ? FOR UPDATE").param(id)
                .query(TeamRepository::map).optional();
    }

    /** Equipes num raio (m) do ponto, da mais perto para a mais longe — consulta espacial com índice GiST. */
    public List<Team> within(double lat, double lng, double meters, String status) {
        return db.sql("SELECT " + COLUMNS + """
                         FROM ops_teams
                        WHERE ST_DWithin(position, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :m)
                          AND (CAST(:status AS text) IS NULL OR status = :status)
                        ORDER BY position <-> ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography""")
                .param("lat", lat).param("lng", lng).param("m", meters).param("status", status)
                .query(TeamRepository::map).list();
    }

    public long count() {
        return db.sql("SELECT count(*) FROM ops_teams").query(Long.class).single();
    }

    public void insert(String code, String name, String kind, String baseName, String baseSource, double lat, double lng) {
        db.sql("""
                INSERT INTO ops_teams (code, name, kind, base_name, base_source, base, position, status, is_example)
                VALUES (:code, :name, :kind, :baseName, :baseSource,
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                        ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 'disponivel', true)""")
                .param("code", code).param("name", name).param("kind", kind).param("baseName", baseName)
                .param("baseSource", baseSource).param("lat", lat).param("lng", lng).update();
    }

    public void setStatus(int id, String status) {
        db.sql("UPDATE ops_teams SET status = ?, updated_at = now() WHERE id = ?").params(status, id).update();
    }

    public void moveTo(int id, double lat, double lng) {
        db.sql("UPDATE ops_teams SET position = ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, updated_at = now() WHERE id = :id")
                .param("lat", lat).param("lng", lng).param("id", id).update();
    }
}
