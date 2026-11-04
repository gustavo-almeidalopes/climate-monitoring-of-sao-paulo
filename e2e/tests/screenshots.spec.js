// Capturas de tela para a descrição dos PRs (antes/depois), nos dois temas.
//   SHOT_DIR=fase-1-2 SHOT_PREFIX=depois npx playwright test --grep @screenshot
// Para o "antes", sirva a versão anterior com E2E_ROOT=<pasta> e E2E_PORT=<outra porta>.
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockNetwork, currentPayload, overviewPayload } from "../support/mocks.js";

test.use({ deviceScaleFactor: 2 });

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "..", "docs", "screenshots", process.env.SHOT_DIR || "fase-1-2");
const PREFIX = process.env.SHOT_PREFIX || "depois";

const VALUES = {
    CV: { rain: 6.2, risk: 41, temp: 23.4, hum: 84 },
    ST: { rain: 24.5, risk: 62, temp: 22.8, hum: 91, wind: 14, trend: { direction: "up", minutesAgo: 40, delta: 8 },
        forecast: h => (h === 2 ? 43 : h < 6 ? 12 : 1.5), nowcast: { probability: 0.034, alert: true, expected: 6.1 } },
    JT: { rain: 2.1, risk: 22, temp: 22.1, hum: 80 },
    MG: { rain: 0.4, risk: 12, temp: 23.9, hum: 77, trend: { direction: "flat" } },
};
const UPDATED = () => new Date(Date.now() - 3 * 60_000);

async function load(page, theme, { offline = false } = {}) {
    await page.addInitScript(t => localStorage.setItem("climasp_theme", t), theme === "claro" ? "light" : "dark");
    await mockNetwork(page, {
        apiDown: offline,
        current: () => currentPayload(VALUES, UPDATED()),
        overview: () => overviewPayload(VALUES, { updatedAt: UPDATED() }),
    });
    await page.goto("/index.html");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(1200);
}

for (const theme of ["claro", "escuro"]) {
    for (const scenario of ["online", "offline"]) {
        test(`@screenshot ${scenario} tema ${theme}`, async ({ page }, info) => {
            await load(page, theme, { offline: scenario === "offline" });
            await page.screenshot({ path: path.join(OUT, `${PREFIX}-${scenario}-${theme}-${info.project.name}.png`) });
        });
    }
}

test("@screenshot detalhes da Fase 1 e 2", async ({ page }, info) => {
    test.skip(PREFIX === "antes", "só existe na versão nova");
    const mobile = info.project.name === "celular";
    await load(page, "claro");
    if (mobile) await page.locator("#btnRegions").click();
    await page.locator(".rl-row").first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-detalhe-regiao-${info.project.name}.png`) });
    if (mobile) await page.locator("#sideClose").click();
    else await page.locator("#rdBack").click();

    await page.locator("#tlRange").fill("2");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-linha-do-tempo-previsto-${info.project.name}.png`) });
    await page.locator("#tlNow").click();

    if (!mobile) {
        await page.locator("#cpToggle").click();
        await page.locator('.lp-row[data-layer="geosampa"]').click();
        await page.locator('.lp-row[data-layer="support"]').click();
        await page.locator("#cpToggle").click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(OUT, `${PREFIX}-camadas-reais-${info.project.name}.png`) });
    }
});

test("@screenshot detalhe tema escuro", async ({ page }, info) => {
    test.skip(PREFIX === "antes" || info.project.name !== "desktop", "só desktop, versão nova");
    await load(page, "escuro");
    await page.locator(".rl-row").first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-detalhe-regiao-escuro-desktop.png`) });
});

import { mockOps } from "../support/mocks.js";

test("@screenshot fase 3: operação", async ({ page }, info) => {
    test.skip(PREFIX === "antes", "só existe na versão nova");
    const mobile = info.project.name === "celular";
    await page.addInitScript(() => localStorage.setItem("climasp_theme", "light"));
    await mockNetwork(page, { overview: () => overviewPayload({ ...VALUES, CV: { rain: 6.2, risk: 41, forecast: h => (h === 1 ? 28 : 3) } }, { updatedAt: UPDATED() }) });
    await mockOps(page);
    await page.goto("/index.html?operador=1");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    if (mobile) await page.locator("#btnRegions").click();
    await page.locator("#tabOps").click();
    await page.locator("#opsToken").fill("op-teste");
    await page.locator("#opsLoginForm button[type=submit]").click();
    await expect(page.locator("#opsWho")).toHaveText("Operador");
    await page.locator("#opsPick").click();
    const box = await page.locator("#map").boundingBox();
    await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.55);
    await expect(page.locator("#opsCandidates .cand")).toHaveCount(3);
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-despacho-${info.project.name}.png`) });

    if (!mobile) {
        await page.locator("#opsCoverageToggle").check();
        await expect(page.locator("#opsCoverageSummary")).toContainText("alcançada");
        await page.locator("#opsCoverageToggle").scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT, `${PREFIX}-cobertura-isocronas-desktop.png`) });
        await page.locator("#opsCoverageToggle").uncheck();
        await page.locator("#opsDescription").fill("Rua alagada, carro ilhado");
        await page.locator("#opsCandidates [data-dispatch]").first().click();
        await expect(page.locator("#opsIncidents .inc-card")).toHaveCount(1);
        await page.locator("#opsReportRefresh").click();
        await expect(page.locator("#opsReport")).toContainText("mm");
        await page.locator("#opsIncidents").scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `${PREFIX}-ocorrencia-e-sugestao-desktop.png`) });
    }
});
