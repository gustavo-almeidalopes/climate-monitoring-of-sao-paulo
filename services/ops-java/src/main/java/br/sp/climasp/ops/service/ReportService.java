package br.sp.climasp.ops.service;

import br.sp.climasp.ops.config.OpsProperties;
import br.sp.climasp.ops.domain.Incident;
import br.sp.climasp.ops.repo.IncidentRepository;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Relatório pós-evento: os indicadores de ocorrências são calculados aqui (dono dos dados); a
 * chuva acumulada e o acerto do modelo vêm do backend Python (/api/v1/ops/report/context),
 * repassando a credencial de quem pediu. Mesmo JSON do /ops/report do Python.
 */
@Service
public class ReportService {

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);

    private final IncidentRepository incidents;
    private final RestClient python;

    public ReportService(IncidentRepository incidents, OpsProperties props) {
        this.incidents = incidents;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(3));
        factory.setReadTimeout(Duration.ofSeconds(15));
        this.python = RestClient.builder().baseUrl(props.pythonBaseUrl().replaceAll("/$", "")).requestFactory(factory).build();
    }

    public Map<String, Object> report(int hours, String authorization) {
        OffsetDateTime end = OffsetDateTime.now(ZoneOffset.UTC);
        OffsetDateTime start = end.minusHours(hours);
        List<Incident> list = incidents.openedSince(start);

        Map<String, Integer> byStatus = new LinkedHashMap<>();
        for (String s : List.of("aberta", "despachada", "no_local", "resolvida")) byStatus.put(s, 0);
        for (Incident i : list) byStatus.merge(i.status(), 1, Integer::sum);

        Map<String, Object> inc = new LinkedHashMap<>();
        inc.put("total", list.size());
        inc.put("by_status", byStatus);
        inc.put("mean_minutes_to_dispatch", mean(list, Incident::assignedAt));
        inc.put("mean_minutes_to_arrival", mean(list, Incident::arrivedAt));
        inc.put("mean_minutes_to_resolution", mean(list, Incident::resolvedAt));

        JsonNode ctx = context(hours, authorization);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("start", start);
        out.put("end", end);
        out.put("hours", hours);
        out.put("rain", ctx != null ? ctx.path("rain") : Map.of());
        out.put("incidents", inc);
        out.put("model", ctx != null ? ctx.path("model") : unavailableModel());
        return out;
    }

    private JsonNode context(int hours, String authorization) {
        try {
            return python.get().uri("/api/v1/ops/report/context?hours={h}", hours)
                    .header("Authorization", authorization).retrieve().body(JsonNode.class);
        } catch (RuntimeException e) {
            log.warn("Contexto de clima indisponível (backend Python): {}", e.toString());
            return null;
        }
    }

    private static Map<String, Object> unavailableModel() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("evaluated", 0);
        m.put("precision", null);
        m.put("recall", null);
        m.put("note", "Dados de chuva e do modelo indisponíveis: o backend de clima (Python) não respondeu.");
        return m;
    }

    static Double mean(List<Incident> list, Function<Incident, OffsetDateTime> to) {
        double sum = 0;
        int n = 0;
        for (Incident i : list) {
            OffsetDateTime t = to.apply(i);
            if (t == null) continue;
            sum += Duration.between(i.openedAt(), t).toMillis() / 60000.0;
            n++;
        }
        return n == 0 ? null : Math.round(sum / n * 10) / 10.0;
    }
}
