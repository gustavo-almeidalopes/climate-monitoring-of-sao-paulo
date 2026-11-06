package br.sp.climasp.ops.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/** Configuração do serviço (application.yml, alimentado por variáveis de ambiente). */
@ConfigurationProperties(prefix = "climasp")
public record OpsProperties(
        String operatorToken,
        String managerToken,
        @DefaultValue("true") boolean seedExamples,
        @DefaultValue("../../data/geo") String geoDataDir,
        @DefaultValue("http://localhost:8000") String pythonBaseUrl,
        Routing routing) {

    public record Routing(
            @DefaultValue("auto") String engine,
            String osmFile,
            @DefaultValue("graph-cache") String graphCacheDir,
            String osrmUrl) {
    }

    public boolean opsConfigured() {
        return notBlank(operatorToken) || notBlank(managerToken);
    }

    static boolean notBlank(String s) {
        return s != null && !s.isBlank();
    }
}
