// Fase 3: perfis, equipes, despacho por tempo de chegada, ocorrências, cobertura, sugestões e indicadores.
import { test, expect } from "@playwright/test";
import { mockNetwork, mockOps, overviewPayload } from "../support/mocks.js";

async function open(page, info, { values = {}, ops = {}, url = "/index.html?operador=1" } = {}) {
    const net = await mockNetwork(page, { overview: () => overviewPayload(values, { updatedAt: new Date(Date.now() - 3 * 60e3) }) });
    const db = await mockOps(page, ops);
    await page.goto(url);
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    if (info.project.name === "celular") await page.locator("#btnRegions").click();
    return { net, db };
}

async function login(page, token = "op-teste") {
    await page.locator("#tabOps").click();
    await page.locator("#opsToken").fill(token);
    await page.locator("#opsLoginForm button[type=submit]").click();
}

test("cidadão não vê a aba de operação", async ({ page }, info) => {
    await open(page, info, { url: "/index.html" });
    await expect(page.locator("#tabOps")).toBeHidden();
});

test("servidor sem tokens configurados explica o que falta", async ({ page }, info) => {
    await open(page, info, { ops: { configured: false } });
    await login(page);
    await expect(page.locator("#opsLoginError")).toContainText("OPERATOR_TOKEN");
});

test("credencial inválida é recusada", async ({ page }, info) => {
    await open(page, info);
    await login(page, "errada");
    await expect(page.locator("#opsLoginError")).toHaveText("Credencial inválida.");
    await expect(page.locator("#opsBody")).toBeHidden();
});

test("operador: 3 equipes mais rápidas por rota, despacho e linha do tempo até resolver", async ({ page }, info) => {
    const { db } = await open(page, info);
    await login(page);
    await expect(page.locator("#opsWho")).toHaveText("Operador");
    await expect(page.locator("#opsTeamsNote")).toBeVisible();
    await expect(page.locator(".team-pin")).toHaveCount(5);

    await page.locator("#opsPick").click();
    await expect(page.locator("#map")).toHaveClass(/picking/);
    if (info.project.name === "celular") await expect(page.locator("#sidePanel")).toBeHidden(); // gaveta sai da frente
    const box = await page.locator("#map").boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await expect(page.locator("#opsCandidates")).toBeVisible(); // e volta com o resultado

    const cands = page.locator("#opsCandidates .cand");
    await expect(cands).toHaveCount(3);
    await expect(cands.first()).toContainText(/\d+ min/);
    await expect(cands.first()).toContainText(/zona crítica/);
    expect(db.calls.filter(c => c === "OSRM table").length).toBe(1);
    expect(db.calls.filter(c => c === "OSRM route").length).toBeGreaterThanOrEqual(3);
    await expect(page.locator(".dispatch-route")).toHaveCount(1);

    await page.locator("#opsDescription").fill("Rua alagada, carro ilhado");
    const firstName = (await cands.first().locator("strong").first().textContent()).trim();
    await cands.first().locator("[data-dispatch]").click();
    await expect(page.locator("#toastMsg")).toContainText(`${firstName} despachada`);
    const card = page.locator("#opsIncidents .inc-card").first();
    await expect(card).toContainText("Rua alagada, carro ilhado");
    await expect(card.locator(".inc-steps li.done")).toHaveCount(2);
    await expect(page.locator(".team-pin.st-em_deslocamento")).toHaveCount(1);

    await card.locator('[data-act="arrive"]').click();
    await expect(card.locator(".inc-steps li.done")).toHaveCount(3);
    await card.locator('[data-act="resolve"]').click();
    await expect(page.locator("#opsIncidents")).toContainText("Nenhuma ocorrência ativa");
    await expect(page.locator("#opsResolvedCount")).toHaveText("1");
    await expect(page.locator(".team-pin.st-em_deslocamento")).toHaveCount(0);
});

test("sem OSRM, os tempos aparecem como estimativa em linha reta", async ({ page }, info) => {
    await open(page, info, { ops: { osrmDown: true } });
    await login(page);
    await page.locator("#opsPick").click();
    if (info.project.name === "celular") await expect(page.locator("#sidePanel")).toBeHidden();
    const box = await page.locator("#map").boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await expect(page.locator("#opsCandidates .cand").first()).toContainText("estimativa em linha reta");
});

test("chuva forte prevista gera sugestão de pré-posicionamento", async ({ page }, info) => {
    await open(page, info, { values: { ST: { rain: 3, risk: 20, forecast: h => (h === 1 ? 30 : 2) } } });
    await login(page);
    const sug = page.locator("#opsSuggestions .sug");
    await expect(sug).toHaveCount(1);
    await expect(sug).toContainText("Santana");
    await expect(sug).toContainText("previsto");
    await sug.locator("[data-preposition]").click();
    await expect(page.locator("#toastMsg")).toContainText("pré-posicionada em Santana");
});

test("gestor só lê: sem despacho, com indicadores", async ({ page }, info) => {
    await open(page, info);
    await login(page, "gestor-teste");
    await expect(page.locator("#opsWho")).toContainText("Gestor");
    await expect(page.locator("#opsDispatchBox")).toBeHidden();
    await expect(page.locator("#opsTeams select")).toHaveCount(0);
    await page.locator("#opsReportRefresh").click();
    await expect(page.locator("#opsReport")).toContainText("31,5 mm");
    await expect(page.locator("#opsReport")).toContainText("precisão 25%");
    await expect(page.locator("#opsReport")).toContainText("9,1 min");
});

test("cobertura: isócronas 5/10/15 min e buracos de cobertura", async ({ page }, info) => {
    await open(page, info);
    await login(page);
    await page.locator("#opsCoverageToggle").check();
    await expect(page.locator("#opsCoverageSummary")).toContainText(/da área alcançada em até 10 min|ainda não calculada/);
    if ((await page.locator("#opsCoverageSummary").textContent()).includes("alcançada")) {
        expect(await page.locator("path.cov").count()).toBeGreaterThan(1000);
        await expect(page.locator("#opsCoverageLegend li")).toHaveCount(4);
        await page.locator("#opsCoverageKind").selectOption("samu");
        await expect(page.locator("#opsCoverageSummary")).toContainText("células acima de 15 min");
    }
});

test("sessão lembra o login e 'Sair' encerra", async ({ page }, info) => {
    await open(page, info);
    await login(page);
    await expect(page.locator("#opsBody")).toBeVisible();
    await page.reload();
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    if (info.project.name === "celular") await page.locator("#btnRegions").click();
    await page.locator("#tabOps").click();
    await expect(page.locator("#opsWho")).toHaveText("Operador");
    await page.locator("#opsLogout").click();
    await expect(page.locator("#opsLogin")).toBeVisible();
    await expect(page.locator(".team-pin")).toHaveCount(0);
});

test("com ?dev=1 os erros do navegador vão para o servidor (logs do Simulador iOS)", async ({ page }) => {
    const sent = [];
    await mockNetwork(page, {});
    await page.route(/\/api\/v1\/dev\/client-log/, route => { sent.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 204 }); });
    await page.goto("/index.html?dev=1");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    await page.evaluate(() => setTimeout(() => { throw new Error("falha de teste no navegador"); }, 0));
    await expect.poll(() => sent.map(s => s.message).join(" | ")).toContain("falha de teste no navegador");
    expect(sent.some(s => s.level === "info" && s.message.startsWith("devlog ativo"))).toBe(true);
});

test("sem ?dev=1 nada é enviado", async ({ page }) => {
    const sent = [];
    await mockNetwork(page, {});
    await page.route(/\/api\/v1\/dev\/client-log/, route => { sent.push(route.request().url()); return route.fulfill({ status: 204 }); });
    await page.goto("/index.html");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    await page.evaluate(() => setTimeout(() => { throw new Error("x"); }, 0));
    await page.waitForTimeout(500);
    expect(sent).toEqual([]);
});

test("modo operador logado não cria rolagem horizontal (360 px)", async ({ page }, info) => {
    await open(page, info, { values: { CV: { rain: 3, forecast: h => (h === 1 ? 28 : 2) } } });
    await login(page);
    await expect(page.locator("#opsWho")).toHaveText("Operador");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator("#opsSuggestions")).not.toContainText("limao");
});

test("painel de operação sem emojis nem glifos (ícones SVG + texto)", async ({ page }, info) => {
    await open(page, info, { values: { CV: { rain: 3, forecast: h => (h === 1 ? 28 : 2) } } });
    await login(page);
    await page.locator("#opsPick").click();
    const box = await page.locator("#map").boundingBox();
    await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5);
    await expect(page.locator("#opsCandidates .cand")).toHaveCount(3);
    await page.locator("#opsCandidates [data-dispatch]").first().click();
    await expect(page.locator("#opsIncidents .inc-card")).toHaveCount(1);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}\u{2022}\u{FE0F}]/u);
});
