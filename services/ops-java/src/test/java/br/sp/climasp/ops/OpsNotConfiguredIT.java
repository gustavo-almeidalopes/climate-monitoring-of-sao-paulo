package br.sp.climasp.ops;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/** Sem OPERATOR_TOKEN/MANAGER_TOKEN: 503 explicando o que falta — nunca um token padrão. */
@SpringBootTest
@AutoConfigureMockMvc
class OpsNotConfiguredIT {

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        var db = PostgisContainer.INSTANCE;
        r.add("spring.datasource.url", db::getJdbcUrl);
        r.add("spring.datasource.username", db::getUsername);
        r.add("spring.datasource.password", db::getPassword);
        r.add("climasp.operator-token", () -> "");
        r.add("climasp.manager-token", () -> "");
    }

    @Autowired MockMvc mvc;

    @Test
    void semTokensAOperacaoFicaDesligada() throws Exception {
        mvc.perform(get("/api/v1/ops/me").header("Authorization", "Bearer qualquer"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.detail").value("Operação não configurada: defina OPERATOR_TOKEN e MANAGER_TOKEN no servidor."));
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/ops-java/openapi.json")).andExpect(status().isOk());
    }
}
