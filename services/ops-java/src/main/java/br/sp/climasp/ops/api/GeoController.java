package br.sp.climasp.ops.api;

import br.sp.climasp.ops.service.GeoService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import java.io.IOException;
import java.util.Map;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Consultas geográficas públicas (sem credencial): o que se sabe sobre um ponto. */
@RestController
@RequestMapping("/api/v1/geo")
@Validated
@Tag(name = "Geografia", description = "Consultas espaciais em PostGIS")
public class GeoController {

    private final GeoService geo;

    public GeoController(GeoService geo) {
        this.geo = geo;
    }

    @Operation(summary = "Este ponto está em zona de risco? Célula H3, distrito, subprefeitura e áreas oficiais do GeoSampa")
    @GetMapping("/point")
    public Map<String, Object> point(@RequestParam @DecimalMin("-90") @DecimalMax("90") double lat,
                                     @RequestParam @DecimalMin("-180") @DecimalMax("180") double lng) throws IOException {
        return geo.pointInfo(lat, lng);
    }
}
