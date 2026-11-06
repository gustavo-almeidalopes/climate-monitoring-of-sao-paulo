package br.sp.climasp.ops;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * Contrato da API de operação contra PostGIS real: as mesmas regras que tests/test_ops.py
 * verifica no backend Python, para os dois lados serem intercambiáveis atrás do gateway.
 */
@SpringBootTest
@AutoConfigureMockMvc
class OpsApiIT {

    static final String OP = "Bearer op-teste";
    static final String GESTOR = "Bearer gestor-teste";
    /** Ponto em Santana (centro de referência da subprefeitura ST). */
    static final double LAT = -23.485, LNG = -46.615;

    /** Backend Python simulado: responde o contexto do relatório e guarda a credencial recebida. */
    static final AtomicReference<String> pythonAuth = new AtomicReference<>();
    static HttpServer python;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) throws Exception {
        python = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        python.createContext("/api/v1/ops/report/context", ex -> {
            pythonAuth.set(ex.getRequestHeaders().getFirst("Authorization"));
            byte[] body = """
                    {"start":"x","end":"y","rain":{"ST":{"total_mm":31.5,"hours":24,"source":"teste"}},
                     "model":{"evaluated":2,"precision":1.0,"recall":0.5,"note":null}}""".getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "application/json");
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        python.start();
        var db = PostgisContainer.INSTANCE;
        r.add("spring.datasource.url", db::getJdbcUrl);
        r.add("spring.datasource.username", db::getUsername);
        r.add("spring.datasource.password", db::getPassword);
        r.add("climasp.operator-token", () -> "op-teste");
        r.add("climasp.manager-token", () -> "gestor-teste");
        r.add("climasp.python-base-url", () -> "http://127.0.0.1:" + python.getAddress().getPort());
        r.add("climasp.routing.engine", () -> "estimativa");
    }

    @AfterAll
    static void stopPython() {
        python.stop(0);
    }

    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcClient db;

    @BeforeEach
    void cleanIncidentsAndFreeTeams() {
        db.sql("DELETE FROM ops_incidents").update();
        db.sql("UPDATE ops_teams SET status = 'disponivel', position = base").update();
    }

    JsonNode body(ResultActions r) throws Exception {
        return json.readTree(r.andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    ResultActions postJson(String url, String auth, String content) throws Exception {
        return mvc.perform(post(url).header("Authorization", auth).contentType(MediaType.APPLICATION_JSON).content(content));
    }

    @Test
    void perfisComAsMesmasMensagensDoBackendPython() throws Exception {
        mvc.perform(get("/api/v1/ops/teams")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Credencial ausente."));
        mvc.perform(get("/api/v1/ops/teams").header("Authorization", "Bearer errada")).andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.detail").value("Credencial inválida."));
        mvc.perform(get("/api/v1/ops/me").header("Authorization", GESTOR)).andExpect(jsonPath("$.role").value("gestor"));
        mvc.perform(get("/api/v1/ops/me").header("Authorization", OP)).andExpect(jsonPath("$.role").value("operador"));
        mvc.perform(get("/api/v1/ops/teams").header("Authorization", GESTOR)).andExpect(status().isOk());
        postJson("/api/v1/ops/incidents", GESTOR, "{\"lat\":-23.48,\"lng\":-46.61}").andExpect(status().isForbidden())
                .andExpect(jsonPath("$.detail").value("Ação restrita ao perfil operador."));
    }

    @Test
    void equipesDeExemploSemeadasDoMesmoArquivoDoPython() throws Exception {
        JsonNode teams = body(mvc.perform(get("/api/v1/ops/teams").header("Authorization", GESTOR)));
        JsonNode file = json.readTree(new java.io.File("../../data/geo/example-teams.json")).path("teams");
        assertThat(teams.size()).isEqualTo(file.size());
        for (JsonNode t : teams) {
            assertThat(t.path("name").asText()).startsWith("[EXEMPLO]");
            assertThat(t.path("is_example").asBoolean()).isTrue();
        }
        // mesmo JSON do TeamOut (app/controllers/ops_controller.py)
        Set<String> keys = new HashSet<>();
        teams.get(0).fieldNames().forEachRemaining(keys::add);
        assertThat(keys).containsExactlyInAnyOrder("id", "code", "name", "kind", "status", "lat", "lng", "base_name",
                "base_source", "base_lat", "base_lng", "is_example", "updated_at");
    }

    @Test
    void cicloCompletoDaOcorrenciaComConflitos() throws Exception {
        JsonNode inc = body(postJson("/api/v1/ops/incidents", OP,
                "{\"lat\":" + LAT + ",\"lng\":" + LNG + ",\"description\":\"rua alagada\"}").andExpect(status().isCreated()));
        int id = inc.path("id").asInt();
        assertThat(inc.path("region").asText()).isEqualTo("ST"); // PostGIS: célula H3 mais próxima
        assertThat(inc.path("status").asText()).isEqualTo("aberta");
        Set<String> keys = new HashSet<>();
        inc.fieldNames().forEachRemaining(keys::add);
        assertThat(keys).containsExactlyInAnyOrder("id", "kind", "description", "address", "lat", "lng", "region", "status",
                "team_id", "eta_minutes", "opened_at", "assigned_at", "arrived_at", "resolved_at", "is_example", "timeline");

        JsonNode teams = body(mvc.perform(get("/api/v1/ops/teams").header("Authorization", OP)));
        int team = teams.get(0).path("id").asInt();
        int other = teams.get(1).path("id").asInt();

        postJson("/api/v1/ops/incidents/" + id + "/arrive", OP, "").andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("A ocorrência precisa ter equipe designada."));

        JsonNode assigned = body(postJson("/api/v1/ops/incidents/" + id + "/assign", OP,
                "{\"team_id\":" + team + ",\"eta_minutes\":7.4}").andExpect(status().isOk()));
        assertThat(assigned.path("status").asText()).isEqualTo("despachada");
        assertThat(assigned.path("timeline").get(1).path("note").asText()).endsWith("chegada estimada em 7 min");

        // segunda ocorrência não pode usar a mesma equipe, que está em deslocamento
        int id2 = body(postJson("/api/v1/ops/incidents", OP, "{\"lat\":-23.49,\"lng\":-46.66}")).path("id").asInt();
        postJson("/api/v1/ops/incidents/" + id2 + "/assign", OP, "{\"team_id\":" + team + "}").andExpect(status().isConflict());

        // trocar de equipe libera a anterior
        postJson("/api/v1/ops/incidents/" + id + "/assign", OP, "{\"team_id\":" + other + "}").andExpect(status().isOk());
        assertThat(teamStatus(team)).isEqualTo("disponivel");
        assertThat(teamStatus(other)).isEqualTo("em_deslocamento");

        JsonNode arrived = body(postJson("/api/v1/ops/incidents/" + id + "/arrive", OP, "").andExpect(status().isOk()));
        assertThat(arrived.path("status").asText()).isEqualTo("no_local");
        assertThat(teamStatus(other)).isEqualTo("em_ocorrencia");

        JsonNode resolved = body(postJson("/api/v1/ops/incidents/" + id + "/resolve", OP, "{\"note\":\"água baixou\"}")
                .andExpect(status().isOk()));
        assertThat(resolved.path("status").asText()).isEqualTo("resolvida");
        assertThat(teamStatus(other)).isEqualTo("disponivel");
        List<String> kinds = resolved.path("timeline").findValuesAsText("kind");
        assertThat(kinds).containsExactly("aberta", "equipe_designada", "equipe_designada", "no_local", "resolvida");
        postJson("/api/v1/ops/incidents/" + id + "/resolve", OP, "{}").andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("Ocorrência já resolvida."));

        // lista sem as resolvidas
        JsonNode active = body(mvc.perform(get("/api/v1/ops/incidents?include_resolved=false").header("Authorization", GESTOR)));
        assertThat(active.findValuesAsText("status")).doesNotContain("resolvida");

        // relatório: ocorrências daqui + chuva e modelo do backend Python, com a credencial repassada
        JsonNode report = body(mvc.perform(get("/api/v1/ops/report?hours=24").header("Authorization", GESTOR)).andExpect(status().isOk()));
        assertThat(report.path("incidents").path("total").asInt()).isEqualTo(2);
        assertThat(report.path("incidents").path("by_status").path("resolvida").asInt()).isEqualTo(1);
        assertThat(report.path("incidents").path("mean_minutes_to_dispatch").isNumber()).isTrue();
        assertThat(report.path("rain").path("ST").path("total_mm").asDouble()).isEqualTo(31.5);
        assertThat(report.path("model").path("precision").asDouble()).isEqualTo(1.0);
        assertThat(pythonAuth.get()).isEqualTo(GESTOR);
    }

    String teamStatus(int id) {
        return db.sql("SELECT status FROM ops_teams WHERE id = ?").param(id).query(String.class).single();
    }

    @Test
    void entradaInvalidaE404NoFormatoDoFastApi() throws Exception {
        postJson("/api/v1/ops/incidents", OP, "{\"lat\":120,\"lng\":-46.6}").andExpect(status().isUnprocessableEntity());
        postJson("/api/v1/ops/incidents/999999/arrive", OP, "").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.detail").value("Ocorrência 999999 não encontrada."));
        mvc.perform(patch("/api/v1/ops/teams/1").header("Authorization", OP).contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\":\"voando\"}")).andExpect(status().isConflict())
                .andExpect(jsonPath("$.detail").value("Status inválido: voando."));
    }

    @Test
    void equipesMaisRapidasOrdenadasEComRotasRotuladas() throws Exception {
        JsonNode r = body(mvc.perform(get("/api/v1/ops/nearest?lat=" + LAT + "&lng=" + LNG + "&limit=3")
                .header("Authorization", OP)).andExpect(status().isOk()));
        assertThat(r.path("source").asText()).isEqualTo("estimativa");
        assertThat(r.path("estimated").asBoolean()).isTrue();
        JsonNode c = r.path("candidates");
        assertThat(c.size()).isEqualTo(3);
        assertThat(c.get(0).path("minutes").asDouble()).isLessThanOrEqualTo(c.get(1).path("minutes").asDouble());
        assertThat(c.get(0).path("routes").get(0).path("coords").size()).isEqualTo(2);
        JsonNode bombeiros = body(mvc.perform(get("/api/v1/ops/nearest?lat=" + LAT + "&lng=" + LNG + "&kind=bombeiros")
                .header("Authorization", OP)));
        assertThat(bombeiros.path("candidates").findValuesAsText("kind")).containsOnly("bombeiros");
    }

    @Test
    void coberturaPorCelulaH3() throws Exception {
        JsonNode cov = body(mvc.perform(get("/api/v1/ops/coverage?kind=todas&max_minutes=60").header("Authorization", GESTOR))
                .andExpect(status().isOk()));
        int cells = cov.path("cells").size();
        assertThat(cells).isGreaterThan(1000);
        assertThat(cov.path("minutes").size()).isEqualTo(cells);
        assertThat(cov.path("bases").asInt()).isGreaterThan(5);
        long reached = 0;
        for (JsonNode m : cov.path("minutes")) if (m.isNumber()) reached++;
        assertThat(reached).isEqualTo(cells); // 60 min em linha reta cobrem toda a Zona Norte
    }

    @Test
    void pontoEmAreaInundavelDoGeoSampa() throws Exception {
        double[] p = db.sql("SELECT ST_Y(ST_PointOnSurface(geom)), ST_X(ST_PointOnSurface(geom)) FROM geo_areas WHERE layer = 'area_inundavel' LIMIT 1")
                .query((rs, i) -> new double[] {rs.getDouble(1), rs.getDouble(2)}).single();
        JsonNode r = body(mvc.perform(get("/api/v1/geo/point?lat=" + p[0] + "&lng=" + p[1])).andExpect(status().isOk()));
        assertThat(r.path("in_flood_area").asBoolean()).isTrue();
        assertThat(r.path("official_areas").findValuesAsText("layer")).contains("area_inundavel");

        JsonNode santana = body(mvc.perform(get("/api/v1/geo/point?lat=" + LAT + "&lng=" + LNG)));
        assertThat(santana.path("inside").asBoolean()).isTrue();
        assertThat(santana.path("region").asText()).isEqualTo("ST");
        assertThat(santana.path("cell").path("h3").asText()).hasSize(15);

        JsonNode longe = body(mvc.perform(get("/api/v1/geo/point?lat=-22.9&lng=-43.2"))); // Rio de Janeiro
        assertThat(longe.path("inside").asBoolean()).isFalse();
    }
}
