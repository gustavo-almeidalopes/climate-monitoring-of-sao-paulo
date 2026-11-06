package br.sp.climasp.ops;

import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** PostgreSQL + PostGIS real (Docker), compartilhado pelos testes de integração. */
public final class PostgisContainer {
    private PostgisContainer() {
    }

    @SuppressWarnings("resource")
    public static final PostgreSQLContainer<?> INSTANCE = new PostgreSQLContainer<>(
            DockerImageName.parse("postgis/postgis:16-3.5-alpine").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("climasp").withUsername("climasp").withPassword("climasp");

    static {
        INSTANCE.start();
    }
}
