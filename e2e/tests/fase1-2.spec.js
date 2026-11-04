// Fases 1 e 2: veredito, critério único, lista/detalhe, "Próximas 3 h", localização,
// zonas que seguem o território, linha do tempo e camadas de dados reais.
import { test, expect } from "@playwright/test";
import { mockNetwork, overviewPayload } from "../support/mocks.js";

const ago = min => new Date(Date.now() - min * 60_000);

async function open(page, values, opts = {}, url = "/index.html") {
    const holder = { values };
    const net = await mockNetwork(page, {
        overview: () => overviewPayload(holder.values, { updatedAt: ago(3), ...(opts.overviewOpts || {}) }),
        ...opts,
    });
    await page.goto(url);
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    return { net, holder };
}

const isMobile = info => info.project.name === "celular";

async function openRegions(page, info) {
    if (isMobile(info)) await page.locator("#btnRegions").click();
    await expect(page.locator("#regionList .rl-row").first()).toBeVisible();
}

test.describe("Fase 1 · veredito", () => {
    test("frase única com região, causa, idade e tendência", async ({ page }) => {
        await open(page, { ST: { rain: 24.5, risk: 40, trend: { direction: "up", minutesAgo: 40, delta: 8 } } });
        await expect(page.locator("#verdictTitle")).toHaveText("Risco ALTO em Santana — chuva de 24,5 mm/h, subindo há 40 min (+8,0 mm/h)");
        await expect(page.locator("#verdictDetail")).toContainText("Dado de 3 min atrás");
        await expect(page.locator("#verdict")).toHaveClass(/lvl-high/);
    });

    test("previsão de piora aparece no veredito", async ({ page }) => {
        await open(page, { ST: { rain: 24.5, risk: 40, trend: { direction: "flat" }, forecast: h => (h === 2 ? 45 : 3) } });
        await expect(page.locator("#verdictTitle")).toContainText("Risco ALTO em Santana — pode chegar a CRÍTICO");
    });

    test("sem chuva agora, mas chuva forte prevista: atenção", async ({ page }) => {
        await open(page, { ST: { rain: 0.5, risk: 5, forecast: h => (h === 2 ? 25 : 0.5) } });
        await expect(page.locator("#verdictTitle")).toContainText("Atenção: chuva forte prevista em Santana");
        await expect(page.locator("#verdict")).toHaveClass(/tone-watch/);
    });

    test("sem risco", async ({ page }) => {
        await open(page, {});
        await expect(page.locator("#verdictTitle")).toHaveText("Sem risco de alagamento agora na Zona Norte monitorada");
    });

    test("regiões empatadas (mesmo ponto de grade) não apontam uma região ao acaso", async ({ page }) => {
        const v = { rain: 22, risk: 40 };
        await open(page, { CV: v, ST: v, JT: v, MG: v });
        await expect(page.locator("#verdictTitle")).toContainText("Risco ALTO em toda a Zona Norte monitorada");
        await expect(page.locator("#verdictDetail")).toContainText("mesmo ponto da grade");
        await expect(page.locator("#map")).not.toHaveAttribute("data-autofocus", /.+/);
    });

    test("sem servidor, o veredito não finge dado real", async ({ page }) => {
        await mockNetwork(page, { apiDown: true });
        await page.goto("/index.html");
        await expect(page.locator("#verdictTitle")).toHaveText("Sem dados reais agora — não use este painel para decisões.");
    });
});

test.describe("Fase 1 · critério único", () => {
    test("risco do modelo eleva o nível igual em veredito, lista, mapa, popup e alerta", async ({ page }, info) => {
        await open(page, { ST: { rain: 3, risk: 80, riskSource: "ml" } });
        await expect(page.locator("#verdictTitle")).toContainText("Risco CRÍTICO em Santana");
        await expect(page.locator("#alertStrip")).toContainText("ALERTA CRÍTICO");
        await openRegions(page, info);
        const first = page.locator("#regionList .rl-row").first();
        await expect(first).toHaveAttribute("data-region", "ST");
        await expect(first).toHaveClass(/lvl-critical/);
        expect(await page.locator(".leaflet-zonesFill-pane path.lvl-critical").count()).toBeGreaterThan(0);
        await first.click();
        await expect(page.locator("#regionDetail .pu-badge")).toHaveText("Crítico");
        await expect(page.locator("#regionDetail .rd-reason")).toContainText("chuva acumulada e previsão do modelo");
    });

    test("índice heurístico (sem modelo) não eleva o nível", async ({ page }) => {
        await open(page, { ST: { rain: 3, risk: 80, riskSource: "heuristic" } });
        await expect(page.locator("#verdictTitle")).toHaveText("Sem risco de alagamento agora na Zona Norte monitorada");
        await expect(page.locator("#alertStrip")).toBeHidden();
        expect(await page.locator(".leaflet-zonesFill-pane path.lvl-critical").count()).toBe(0);
    });
});

test.describe("Fase 1 · lista e detalhe", () => {
    test("lista ordenada por nível com mm/h, tendência, mini-gráfico e idade; clique abre o detalhe", async ({ page }, info) => {
        await open(page, {
            CV: { rain: 6, risk: 30 },
            ST: { rain: 24.5, risk: 60, trend: { direction: "up", minutesAgo: 40, delta: 8 }, nowcast: { probability: 0.012, expected: 0.4 } },
            JT: { rain: 0, risk: 5 },
        });
        await openRegions(page, info);
        const rows = page.locator("#regionList .rl-row");
        await expect(rows).toHaveCount(4);
        await expect(rows.nth(0)).toHaveAttribute("data-region", "ST");
        await expect(rows.nth(1)).toHaveAttribute("data-region", "CV");
        await expect(rows.nth(0)).toContainText("24,5 mm/h");
        await expect(rows.nth(0)).toContainText("subindo há 40 min");
        // a idade do dado fica no veredito; a linha só repete quando a região está atrasada
        await expect(rows.nth(0)).not.toContainText("dado de");
        await expect(rows.nth(0).locator("svg.spark")).toHaveCount(1);

        await rows.nth(0).click();
        const detail = page.locator("#regionDetail");
        await expect(detail.locator("#rdTitle")).toHaveText("Santana");
        await expect(detail.locator(".next3")).toContainText("1% de chance de chuva forte");
        await expect(detail.locator(".next3")).toContainText("Modelo experimental: acerta 7% dos alertas");
        expect(await detail.locator(".chart-svg.rain .bar.observed").count()).toBeGreaterThan(20);
        expect(await detail.locator(".chart-svg.rain .bar.forecast").count()).toBeGreaterThan(40);
        await expect(detail.locator(".chart-svg.risk .band-critical")).toHaveCount(1);
        await detail.locator(".chart-table summary").click();
        expect(await detail.locator(".chart-table tbody tr").count()).toBeGreaterThan(60);
        await detail.locator("#rdBack").click();
        await expect(page.locator(".rl-row").first()).toBeFocused();
    });

    test("valores que mudaram desde a última leitura são destacados", async ({ page }, info) => {
        const { holder } = await open(page, { ST: { rain: 4, risk: 10 } });
        holder.values = { ST: { rain: 12, risk: 20 } };
        await page.locator("#btnRefresh").click();
        await openRegions(page, info);
        await expect(page.locator('.rl-row[data-region="ST"]')).toHaveClass(/changed/);
        await expect(page.locator('.rl-row[data-region="ST"] .rl-rain')).toHaveClass(/is-changed/);
    });

    test("popup da região tem tendência, próximas 3 h e atalho para o detalhe", async ({ page }) => {
        await open(page, { ST: { rain: 24.5, risk: 60, forecast: h => (h === 1 ? 30 : 2) } });
        const box = await page.locator(".subpref-label-inner", { hasText: "Santana" }).boundingBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height + 14); // o rótulo não captura cliques
        const pu = page.locator(".leaflet-popup-content .pu").first();
        await expect(pu).toContainText("Próximas 3 h");
        await expect(pu).toContainText("Dado de 3 min atrás");
        await pu.locator('[data-action="details"]').click();
        await expect(page.locator("#rdTitle")).toBeVisible();
    });

    test("backend antigo sem /overview: painel funciona e a linha do tempo explica o que falta", async ({ page }) => {
        await mockNetwork(page, { legacy: true });
        await page.goto("/index.html");
        await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
        await expect(page.locator("#statusLabel")).toHaveText("Ao vivo");
        await expect(page.locator("#tlHint")).toBeVisible();
        await expect(page.locator("#tlRange")).toBeDisabled();
    });
});

test.describe("Fase 1 · minha localização", () => {
    test("informa o nível da região onde a pessoa está", async ({ page, context }) => {
        await context.grantPermissions(["geolocation"]);
        await context.setGeolocation({ latitude: -23.4985, longitude: -46.629, accuracy: 30 });
        await open(page, { ST: { rain: 24.5, risk: 60 } });
        await page.locator("#btnLocate").click();
        const pu = page.locator(".leaflet-popup-content .ps");
        await expect(pu).toContainText("Sua localização");
        await expect(pu).toContainText("Precisão de ±30 m");
        await expect(pu).toContainText("Alto");
        await expect(pu).toContainText("Santana");
    });

    test("permissão negada vira mensagem clara", async ({ page, context }) => {
        await context.clearPermissions();
        await open(page, {});
        await page.evaluate(() => {
            navigator.geolocation.getCurrentPosition = (_ok, fail) => fail({ code: 1 });
        });
        await page.locator("#btnLocate").click();
        await expect(page.locator("#toastMsg")).toContainText("Permissão de localização negada");
    });
});

test.describe("Fase 2 · zonas no território", () => {
    test("sem círculos: grade hexagonal real pintada pelo nível; distritos como alternativa", async ({ page }, info) => {
        const high = { rain: 24.5, risk: 60 };
        await open(page, { CV: high, ST: high, JT: high, MG: high });
        await expect(page.locator("#map")).toHaveAttribute("data-zones", "hex");
        expect(await page.locator(".leaflet-zonesFill-pane path.hex").count()).toBeGreaterThan(1000);
        expect(await page.locator(".leaflet-zonesFill-pane path.hex.lvl-high").count()).toBeGreaterThan(100);
        // células mais suscetíveis (10%) sobem um nível quando a região já está em Médio+
        expect(await page.locator(".leaflet-zonesFill-pane path.hex.lvl-critical").count()).toBeGreaterThan(0);
        expect(await page.locator(".leaflet-pane path[d*='a']").count()).toBe(0); // L.circle é desenhado com arcos

        if (await page.locator("#controlPanel.collapsed").count()) await page.locator("#cpToggle").click();
        await page.locator('.lp-row[data-overlay="hex"]').click();
        await expect(page.locator("#map")).toHaveAttribute("data-zones", "districts");
        expect(await page.locator(".leaflet-zonesFill-pane path.lvl-high:not(.hex)").count()).toBeGreaterThan(0);
        void info;
    });

    test("só o crítico observado pulsa", async ({ page }) => {
        const { holder } = await open(page, { ST: { rain: 24.5, risk: 40 } });
        expect(await page.locator("path.lvl-high").count()).toBeGreaterThan(0);
        // em Alto, só pulsam as células elevadas a Crítico pela suscetibilidade — nada além do crítico
        expect(await page.locator("path.z-pulse").count()).toBe(await page.locator("path.lvl-critical").count());
        expect(await page.locator(".leaflet-zonesLine-pane path.z-pulse").count()).toBe(0);
        holder.values = { ST: { rain: 45, risk: 90 } };
        await page.locator("#btnRefresh").click();
        await expect.poll(() => page.locator(".leaflet-zonesLine-pane path.z-pulse").count()).toBeGreaterThan(0);
        // no futuro (previsto) não pulsa
        await page.locator("#tlRange").fill("5");
        await expect.poll(() => page.locator("path.z-pulse").count()).toBe(0);
    });

    test("rótulos dinâmicos e foco automático na pior área", async ({ page }) => {
        await open(page, { ST: { rain: 24.5, risk: 60 } });
        await expect(page.locator(".subpref-label-inner", { hasText: "Santana" })).toContainText("Santana · 24,5 mm/h");
        await expect(page.locator("#map")).toHaveAttribute("data-autofocus", "ST");
    });

    test("linha do tempo: previsto aparece hachurado e os rótulos mudam", async ({ page }) => {
        await open(page, { ST: { rain: 2, risk: 10, forecast: h => (h === 3 ? 30 : 1) } });
        await page.locator("#tlRange").fill("3");
        await expect(page.locator("#map")).toHaveAttribute("data-time-kind", "forecast");
        await expect(page.locator("#tlLabel")).toContainText("previsto (+3 h)");
        expect(await page.locator(".leaflet-zonesFill-pane path.z-forecast:is(.lvl-high, .lvl-critical)").count()).toBeGreaterThan(0);
        await expect(page.locator(".subpref-label-inner", { hasText: "Santana" })).toContainText("30,0 mm/h prev.");
        await page.locator("#tlRange").fill("-5");
        await expect(page.locator("#tlLabel")).toContainText("observado (−5 h)");
        await page.locator("#tlNow").click();
        await expect(page.locator("#tlLabel")).toHaveText("Agora");
        await page.locator("#tlPlay").click();
        await expect(page.locator("#tlPlay")).toHaveAttribute("aria-pressed", "true");
        await page.locator("#tlPlay").click();
        await expect(page.locator("#tlPlay")).toHaveAttribute("aria-pressed", "false");
    });
});

test.describe("Fase 2 · camadas reais", () => {
    async function showPanel(page) {
        if (await page.locator("#controlPanel.collapsed").count()) await page.locator("#cpToggle").click();
    }

    test("cursos d'água e vias alagáveis (OSM) aparecem por padrão", async ({ page }) => {
        await open(page, {});
        await expect.poll(() => page.locator(".leaflet-lines-pane path").count()).toBeGreaterThan(500);
        expect(await page.locator(".leaflet-lines-pane path.flood-street").count()).toBeGreaterThan(10);
    });

    test("pontos de apoio, ocorrências do GeoSampa, notícias e radar com ícones e agrupamento", async ({ page }) => {
        await open(page, {}, {
            news: { articles: [{ source: "G1 SP", title: "Alagamento em Santana interdita avenida", summary: "", url: "https://example.com/n1", relevance_score: 7, published_at: new Date().toISOString() }], total: 1 },
        });
        await showPanel(page);
        await page.locator('.lp-row[data-layer="support"]').click();
        await expect.poll(() => page.locator(".poi-hospital, .poi-fire_station, .poi-cluster").count()).toBeGreaterThan(0);
        await page.locator('.lp-row[data-layer="geosampa"]').click();
        await expect.poll(() => page.locator(".poi-occurrence, .poi-cluster.poi-occurrence").count()).toBeGreaterThan(0);
        await page.locator('.lp-row[data-layer="news_map"]').click();
        await expect.poll(() => page.locator(".poi-news").count()).toBeGreaterThan(0);
        await expect(page.locator('.lp-row[data-layer="news_map"] small')).toHaveText("1 citando distritos");
        await page.locator('.lp-row[data-layer="radar"]').click();
        await expect.poll(() => page.locator('.leaflet-radar-pane img[src*="rainviewer"]').count()).toBeGreaterThan(0);
        await expect(page.locator(".leaflet-control-attribution")).toContainText("RainViewer");
    });
});
