package br.sp.climasp.ops.api;

import br.sp.climasp.ops.domain.Incident;
import br.sp.climasp.ops.domain.Team;
import br.sp.climasp.ops.service.DispatchService;
import br.sp.climasp.ops.service.OpsService;
import br.sp.climasp.ops.service.ReportService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * /api/v1/ops — mesmo contrato do backend Python (app/controllers/ops_controller.py), mais as
 * rotas novas /nearest e /coverage (aditivas). Perfis: ver {@link br.sp.climasp.ops.security.TokenAuthFilter}.
 */
@RestController
@RequestMapping("/api/v1/ops")
@Validated
@Tag(name = "Operação", description = "Equipes, ocorrências e despacho (perfis operador e gestor)")
public class OpsController {

    private final OpsService ops;
    private final DispatchService dispatch;
    private final ReportService reports;

    public OpsController(OpsService ops, DispatchService dispatch, ReportService reports) {
        this.ops = ops;
        this.dispatch = dispatch;
        this.reports = reports;
    }

    public record Me(String role) {
    }

    public record TeamPatch(String status,
                            @DecimalMin("-90") @DecimalMax("90") Double lat,
                            @DecimalMin("-180") @DecimalMax("180") Double lng) {
    }

    public record IncidentIn(@NotNull @DecimalMin("-90") @DecimalMax("90") Double lat,
                             @NotNull @DecimalMin("-180") @DecimalMax("180") Double lng,
                             @Size(max = 30) String kind,
                             @Size(max = 500) String description,
                             @Size(max = 200) String address) {
    }

    public record AssignIn(@NotNull Integer teamId, @DecimalMin("0") @DecimalMax("600") Double etaMinutes) {
    }

    public record ResolveIn(@Size(max = 300) String note) {
    }

    private static String role(Authentication auth) {
        return auth.getName();
    }

    @Operation(summary = "Valida a credencial e devolve o perfil (operador ou gestor)")
    @GetMapping("/me")
    public Me me(Authentication auth) {
        return new Me(role(auth));
    }

    @GetMapping("/teams")
    public List<Team> teams() {
        return ops.listTeams();
    }

    @PatchMapping("/teams/{id}")
    public Team patchTeam(@PathVariable int id, @Valid @RequestBody TeamPatch body) {
        return ops.updateTeam(id, body.status(), body.lat(), body.lng());
    }

    @GetMapping("/incidents")
    public List<Incident> incidents(@RequestParam(name = "include_resolved", defaultValue = "true") boolean includeResolved,
                                    @RequestParam(defaultValue = "100") @Min(1) @Max(500) int limit) {
        return ops.listIncidents(includeResolved, limit);
    }

    @PostMapping("/incidents")
    @ResponseStatus(HttpStatus.CREATED)
    public Incident open(@Valid @RequestBody IncidentIn body, Authentication auth) {
        return ops.open(body.lat(), body.lng(), body.kind(), body.description(), body.address(), role(auth));
    }

    @PostMapping("/incidents/{id}/assign")
    public Incident assign(@PathVariable int id, @Valid @RequestBody AssignIn body, Authentication auth) {
        return ops.assign(id, body.teamId(), body.etaMinutes(), role(auth));
    }

    @PostMapping("/incidents/{id}/arrive")
    public Incident arrive(@PathVariable int id, Authentication auth) {
        return ops.arrive(id, role(auth));
    }

    @PostMapping("/incidents/{id}/resolve")
    public Incident resolve(@PathVariable int id, @Valid @RequestBody(required = false) ResolveIn body, Authentication auth) {
        return ops.resolve(id, body == null ? "" : body.note(), role(auth));
    }

    @Operation(summary = "Relatório pós-evento: chuva, ocorrências, tempos de resposta e acerto do modelo")
    @GetMapping("/report")
    public Map<String, Object> report(@RequestParam(defaultValue = "24") @Min(1) @Max(720) int hours,
                                      @RequestHeader("Authorization") String authorization) {
        return reports.report(hours, authorization);
    }

    @Operation(summary = "Equipes disponíveis mais rápidas até um ponto, por tempo de chegada nas ruas (com rotas)")
    @GetMapping("/nearest")
    public DispatchService.Nearest nearest(@RequestParam @DecimalMin("-90") @DecimalMax("90") double lat,
                                           @RequestParam @DecimalMin("-180") @DecimalMax("180") double lng,
                                           @RequestParam(defaultValue = "5") @Min(1) @Max(20) int limit,
                                           @RequestParam(required = false) String kind) {
        return dispatch.nearest(lat, lng, limit, kind);
    }

    @Operation(summary = "Isócronas: menor tempo das bases até cada célula H3 (buracos de cobertura)")
    @GetMapping("/coverage")
    public Map<String, Object> coverage(@RequestParam(defaultValue = "todas") String kind,
                                        @RequestParam(name = "max_minutes", defaultValue = "30") @Min(1) @Max(120) double maxMinutes) {
        return dispatch.coverage(kind, maxMinutes);
    }
}
