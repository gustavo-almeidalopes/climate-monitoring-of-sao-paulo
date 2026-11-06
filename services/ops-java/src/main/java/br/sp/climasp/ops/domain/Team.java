package br.sp.climasp.ops.domain;

import java.time.OffsetDateTime;
import java.util.Set;

/** Equipe de campo. JSON igual ao TeamOut do backend Python (snake_case). */
public record Team(
        int id,
        String code,
        String name,
        String kind,
        String status,
        double lat,
        double lng,
        String baseName,
        String baseSource,
        double baseLat,
        double baseLng,
        boolean isExample,
        OffsetDateTime updatedAt) {

    public static final Set<String> KINDS = Set.of("defesa_civil", "bombeiros", "cet", "samu", "subprefeitura");
    public static final Set<String> STATUSES = Set.of("disponivel", "em_deslocamento", "em_ocorrencia", "indisponivel");

    public LatLng position() {
        return new LatLng(lat, lng);
    }
}
