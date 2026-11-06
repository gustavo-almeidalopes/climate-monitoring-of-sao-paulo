package br.sp.climasp.ops;

import br.sp.climasp.ops.config.OpsProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

/**
 * Serviço de operação do ClimaSP: equipes, ocorrências, despacho por tempo de chegada e
 * consultas geográficas em PostGIS. Roda ao lado do backend Python (padrão strangler) e
 * responde em /api/v1/ops/* e /api/v1/geo/* com o mesmo contrato JSON.
 */
@SpringBootApplication
@EnableConfigurationProperties(OpsProperties.class)
public class OpsApplication {
    public static void main(String[] args) {
        SpringApplication.run(OpsApplication.class, args);
    }
}
