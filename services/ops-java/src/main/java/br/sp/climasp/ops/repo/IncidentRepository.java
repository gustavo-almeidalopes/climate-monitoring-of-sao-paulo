package br.sp.climasp.ops.repo;

import br.sp.climasp.ops.domain.Incident;
import br.sp.climasp.ops.domain.Incident.TimelineEvent;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Ocorrências e eventos da linha do tempo. */
@Repository
public class IncidentRepository {

    private static final String COLUMNS = """
            id, kind, description, address, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
            region_code, status, team_id, eta_minutes, opened_at, assigned_at, arrived_at, resolved_at, is_example""";

    private final JdbcClient db;

    public IncidentRepository(JdbcClient db) {
        this.db = db;
    }

    static Incident map(ResultSet rs, int i) throws SQLException {
        return new Incident(rs.getInt("id"), rs.getString("kind"), rs.getString("description"), rs.getString("address"),
                rs.getDouble("lat"), rs.getDouble("lng"), rs.getString("region_code"), rs.getString("status"),
                (Integer) rs.getObject("team_id"), (Double) rs.getObject("eta_minutes"),
                rs.getObject("opened_at", OffsetDateTime.class), rs.getObject("assigned_at", OffsetDateTime.class),
                rs.getObject("arrived_at", OffsetDateTime.class), rs.getObject("resolved_at", OffsetDateTime.class),
                rs.getBoolean("is_example"), List.of());
    }

    public List<Incident> list(boolean includeResolved, int limit) {
        List<Incident> rows = db.sql("SELECT " + COLUMNS + " FROM ops_incidents"
                        + (includeResolved ? "" : " WHERE status <> 'resolvida'")
                        + " ORDER BY opened_at DESC, id DESC LIMIT ?")
                .param(limit).query(IncidentRepository::map).list();
        return withTimelines(rows);
    }

    public List<Incident> openedSince(OffsetDateTime start) {
        return db.sql("SELECT " + COLUMNS + " FROM ops_incidents WHERE opened_at > ?").param(start)
                .query(IncidentRepository::map).list();
    }

    public Optional<Incident> findById(int id) {
        return db.sql("SELECT " + COLUMNS + " FROM ops_incidents WHERE id = ?").param(id)
                .query(IncidentRepository::map).optional().map(i -> i.withTimeline(events(i.id())));
    }

    public Optional<Incident> lockById(int id) {
        return db.sql("SELECT " + COLUMNS + " FROM ops_incidents WHERE id = ? FOR UPDATE").param(id)
                .query(IncidentRepository::map).optional();
    }

    public int insert(String kind, String description, String address, double lat, double lng, String region,
                      OffsetDateTime at) {
        return db.sql("""
                INSERT INTO ops_incidents (kind, description, address, location, region_code, status, opened_at)
                VALUES (:kind, :description, :address, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                        :region, 'aberta', :at)
                RETURNING id""")
                .param("kind", kind).param("description", description).param("address", address)
                .param("lat", lat).param("lng", lng).param("region", region).param("at", at)
                .query(Integer.class).single();
    }

    public void assign(int id, int teamId, Double eta, OffsetDateTime at) {
        db.sql("""
                UPDATE ops_incidents SET team_id = :team, status = 'despachada',
                       assigned_at = COALESCE(assigned_at, :at), eta_minutes = :eta WHERE id = :id""")
                .param("team", teamId).param("at", at).param("eta", eta).param("id", id).update();
    }

    public void markArrived(int id, OffsetDateTime at) {
        db.sql("UPDATE ops_incidents SET status = 'no_local', arrived_at = ? WHERE id = ?").params(at, id).update();
    }

    public void markResolved(int id, OffsetDateTime at) {
        db.sql("UPDATE ops_incidents SET status = 'resolvida', resolved_at = ? WHERE id = ?").params(at, id).update();
    }

    public void addEvent(int incidentId, OffsetDateTime at, String kind, Integer teamId, String note, String role) {
        db.sql("""
                INSERT INTO ops_incident_events (incident_id, at, kind, team_id, note, actor_role)
                VALUES (?, ?, ?, ?, ?, ?)""")
                .params(incidentId, at, kind, teamId, note, role).update();
    }

    List<TimelineEvent> events(int incidentId) {
        return db.sql("SELECT at, kind, team_id, note, actor_role FROM ops_incident_events WHERE incident_id = ? ORDER BY at, id")
                .param(incidentId).query(IncidentRepository::mapEvent).list();
    }

    private static TimelineEvent mapEvent(ResultSet rs, int i) throws SQLException {
        return new TimelineEvent(rs.getObject("at", OffsetDateTime.class), rs.getString("kind"),
                (Integer) rs.getObject("team_id"), rs.getString("note"), rs.getString("actor_role"));
    }

    /** Linha do tempo de várias ocorrências numa consulta só (evita N+1). */
    private List<Incident> withTimelines(List<Incident> rows) {
        if (rows.isEmpty()) return rows;
        Map<Integer, List<TimelineEvent>> byIncident = new HashMap<>();
        db.sql("SELECT incident_id, at, kind, team_id, note, actor_role FROM ops_incident_events "
                        + "WHERE incident_id = ANY(?) ORDER BY at, id")
                .param(rows.stream().map(Incident::id).toArray(Integer[]::new))
                .query((rs, i) -> {
                    byIncident.computeIfAbsent(rs.getInt("incident_id"), k -> new ArrayList<>()).add(mapEvent(rs, i));
                    return null;
                }).list();
        return rows.stream().map(r -> r.withTimeline(byIncident.getOrDefault(r.id(), List.of()))).toList();
    }
}
