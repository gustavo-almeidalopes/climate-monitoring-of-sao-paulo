// Capturas de tela para a descrição do PR (antes/depois), nos dois temas.
// Rode com: SHOT_PREFIX=depois npx playwright test --grep @screenshot
import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockNetwork, currentPayload } from "../support/mocks.js";

test.use({ deviceScaleFactor: 2 });

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "..", "docs", "screenshots", "fase-0");
const PREFIX = process.env.SHOT_PREFIX || "depois";

const SCENARIO = currentPayload({
    CV: { rain: 6.2, risk: 41, temp: 23.4, hum: 84 },
    ST: { rain: 24.5, risk: 72, temp: 22.8, hum: 91, wind: 14 },
    JT: { rain: 2.1, risk: 22, temp: 22.1, hum: 80 },
    MG: { rain: 0.4, risk: 12, temp: 23.9, hum: 77 },
}, new Date(Date.now() - 3 * 60_000));

for (const theme of ["claro", "escuro"]) {
    for (const scenario of ["online", "offline"]) {
        test(`@screenshot ${scenario} tema ${theme}`, async ({ page }, info) => {
            await page.addInitScript(t => localStorage.setItem("climasp_theme", t), theme === "claro" ? "light" : "dark");
            await mockNetwork(page, { current: SCENARIO, apiDown: scenario === "offline" });
            await page.goto("/index.html");
            await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
            await page.waitForTimeout(900);
            const file = `${PREFIX}-${scenario}-${theme}-${info.project.name}.png`;
            await page.screenshot({ path: path.join(OUT, file) });
        });
    }
}

test("@screenshot detalhes: busca com risco e histórico de alertas", async ({ page }, info) => {
    test.skip(PREFIX === "antes" || info.project.name !== "desktop", "só existe na versão nova");
    const values = { ST: { rain: 24.5, risk: 72 } };
    await page.addInitScript(() => localStorage.setItem("climasp_theme", "light"));
    await mockNetwork(page, {
        current: () => currentPayload(values, new Date(Date.now() - 3 * 60_000)),
        nominatim: [{ lat: "-23.4985", lon: "-46.6290", display_name: "Rua Voluntários da Pátria, Santana, São Paulo, Região Imediata de São Paulo, Brasil" }],
    });
    await page.goto("/index.html");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    values.ST = { rain: 43.0, risk: 91 };
    await page.locator("#btnRefresh").click();
    await expect(page.locator("#alertStrip")).toContainText("ALERTA CRÍTICO");
    await page.locator("#searchInput").fill("Voluntários da Pátria");
    await page.locator("#searchBtn").click();
    await expect(page.locator(".leaflet-popup-content .ps")).toBeVisible();
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-busca-com-risco.png`) });
    await page.locator("#btnAlerts").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT, `${PREFIX}-historico-alertas.png`) });
});
