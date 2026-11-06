package br.sp.climasp.ops.domain;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;

/** Ocorrência com a linha do tempo. JSON igual ao IncidentOut do backend Python. */
public record Incident(
        int id,
        String kind,
        String description,
        String address,
        double lat,
        double lng,
        String region,
        String status,
        Integer teamId,
        Double etaMinutes,
        OffsetDateTime openedAt,
        OffsetDateTime assignedAt,
        OffsetDateTime arrivedAt,
        OffsetDateTime resolvedAt,
        boolean isExample,
        List<TimelineEvent> timeline) {

    public static final Set<String> STATUSES = Set.of("aberta", "despachada", "no_local", "resolvida");

    public record TimelineEvent(OffsetDateTime at, String kind, Integer teamId, String note, String actorRole) {
    }

    public Incident withTimeline(List<TimelineEvent> events) {
        return new Incident(id, kind, description, address, lat, lng, region, status, teamId, etaMinutes, openedAt,
                assignedAt, arrivedAt, resolvedAt, isExample, events);
    }
}
