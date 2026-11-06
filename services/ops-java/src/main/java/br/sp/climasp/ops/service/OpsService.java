package br.sp.climasp.ops.service;

import br.sp.climasp.ops.domain.Incident;
import br.sp.climasp.ops.domain.OpsErrors.Conflict;
import br.sp.climasp.ops.domain.OpsErrors.NotFound;
import br.sp.climasp.ops.domain.Team;
import br.sp.climasp.ops.repo.IncidentRepository;
import br.sp.climasp.ops.repo.TeamRepository;
import java.time.Clock;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Equipes e ciclo da ocorrência (aberta -> despachada -> no local -> resolvida), com as mesmas
 * regras e mensagens do backend Python (app/services/ops_service.py). Linhas de equipe e
 * ocorrência são travadas (SELECT … FOR UPDATE) para dois operadores não despacharem a mesma
 * equipe ao mesmo tempo.
 */
@Service
public class OpsService {

    private final TeamRepository teams;
    private final IncidentRepository incidents;
    private final GeoService geo;
    private final Clock clock;

    public OpsService(TeamRepository teams, IncidentRepository incidents, GeoService geo) {
        this.teams = teams;
        this.incidents = incidents;
        this.geo = geo;
        this.clock = Clock.systemUTC();
    }

    private OffsetDateTime now() {
        return OffsetDateTime.now(clock).withOffsetSameInstant(ZoneOffset.UTC);
    }

    public List<Team> listTeams() {
        return teams.findAll();
    }

    @Transactional
    public Team updateTeam(int id, String status, Double lat, Double lng) {
        teams.lockById(id).orElseThrow(() -> new NotFound("Equipe " + id + " não encontrada."));
        if (status != null) {
            if (!Team.STATUSES.contains(status)) throw new Conflict("Status inválido: " + status + ".");
            teams.setStatus(id, status);
        }
        if (lat != null && lng != null) teams.moveTo(id, lat, lng);
        if (status == null && (lat == null || lng == null)) teams.setStatus(id, teams.findById(id).orElseThrow().status());
        return teams.findById(id).orElseThrow();
    }

    public List<Incident> listIncidents(boolean includeResolved, int limit) {
        return incidents.list(includeResolved, limit);
    }

    private Incident get(int id) {
        return incidents.findById(id).orElseThrow(() -> new NotFound("Ocorrência " + id + " não encontrada."));
    }

    private Incident lock(int id) {
        return incidents.lockById(id).orElseThrow(() -> new NotFound("Ocorrência " + id + " não encontrada."));
    }

    @Transactional
    public Incident open(double lat, double lng, String kind, String description, String address, String role) {
        OffsetDateTime at = now();
        String desc = cut(description, 500);
        int id = incidents.insert(kind == null || kind.isBlank() ? "alagamento" : kind, desc, cut(address, 200), lat, lng,
                geo.regionAt(lat, lng), at);
        incidents.addEvent(id, at, "aberta", null, cut(description, 300), role);
        return get(id);
    }

    @Transactional
    public Incident assign(int incidentId, int teamId, Double etaMinutes, String role) {
        Incident inc = lock(incidentId);
        if ("resolvida".equals(inc.status())) throw new Conflict("Ocorrência já resolvida.");
        Team team = teams.lockById(teamId).orElseThrow(() -> new NotFound("Equipe " + teamId + " não encontrada."));
        if (!"disponivel".equals(team.status())) {
            throw new Conflict(team.name() + " não está disponível (" + team.status() + ").");
        }
        OffsetDateTime at = now();
        if (inc.teamId() != null && inc.teamId() != teamId) {
            teams.lockById(inc.teamId()).ifPresent(prev -> {
                if (prev.status().equals("em_deslocamento") || prev.status().equals("em_ocorrencia")) {
                    teams.setStatus(prev.id(), "disponivel");
                }
            });
        }
        teams.setStatus(teamId, "em_deslocamento");
        incidents.assign(incidentId, teamId, etaMinutes, at);
        String note = team.name() + (etaMinutes != null
                ? String.format(Locale.ROOT, " · chegada estimada em %.0f min", etaMinutes) : "");
        incidents.addEvent(incidentId, at, "equipe_designada", teamId, note, role);
        return get(incidentId);
    }

    @Transactional
    public Incident arrive(int incidentId, String role) {
        Incident inc = lock(incidentId);
        if (!"despachada".equals(inc.status()) || inc.teamId() == null) {
            throw new Conflict("A ocorrência precisa ter equipe designada.");
        }
        OffsetDateTime at = now();
        teams.lockById(inc.teamId()).ifPresent(t -> {
            teams.setStatus(t.id(), "em_ocorrencia");
            teams.moveTo(t.id(), inc.lat(), inc.lng());
        });
        incidents.markArrived(incidentId, at);
        incidents.addEvent(incidentId, at, "no_local", inc.teamId(), "Equipe no local", role);
        return get(incidentId);
    }

    @Transactional
    public Incident resolve(int incidentId, String note, String role) {
        Incident inc = lock(incidentId);
        if ("resolvida".equals(inc.status())) throw new Conflict("Ocorrência já resolvida.");
        OffsetDateTime at = now();
        if (inc.teamId() != null) {
            teams.lockById(inc.teamId()).ifPresent(t -> {
                if (t.status().equals("em_deslocamento") || t.status().equals("em_ocorrencia")) teams.setStatus(t.id(), "disponivel");
            });
        }
        incidents.markResolved(incidentId, at);
        incidents.addEvent(incidentId, at, "resolvida", inc.teamId(), cut(note, 300), role);
        return get(incidentId);
    }

    static String cut(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }
}
