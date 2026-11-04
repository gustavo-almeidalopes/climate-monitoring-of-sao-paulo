// Checagem automática de acessibilidade (axe-core) — WCAG 2.1 A/AA, nos dois temas.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockNetwork, currentPayload } from "../support/mocks.js";

const CASES = [
    { name: "online com alerta", opts: { current: currentPayload({ ST: { rain: 25, risk: 70 }, CV: { rain: 6 } }) } },
    { name: "offline (dados de exemplo)", opts: { apiDown: true } },
];

for (const theme of ["light", "dark"]) {
    for (const c of CASES) {
        test(`axe sem violações sérias · ${c.name} · tema ${theme}`, async ({ page }) => {
            await page.addInitScript(t => localStorage.setItem("climasp_theme", t), theme);
            await mockNetwork(page, c.opts);
            await page.goto("/index.html");
            await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
            await page.waitForTimeout(500); // transições de entrada

            const results = await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
                .exclude(".leaflet-tile-pane")
                .analyze();
            const serious = results.violations
                .filter(v => v.impact === "serious" || v.impact === "critical")
                .map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 5).map(n => n.target.join(" ")) }));
            expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
        });
    }
}

import { overviewPayload } from "../support/mocks.js";

for (const theme of ["light", "dark"]) {
    test(`axe sem violações sérias · detalhe com gráficos e previsão · tema ${theme}`, async ({ page }, info) => {
        await page.addInitScript(t => localStorage.setItem("climasp_theme", t), theme);
        await mockNetwork(page, { overview: () => overviewPayload({ ST: { rain: 24.5, risk: 60, forecast: h => (h === 2 ? 42 : 4) } }) });
        await page.goto("/index.html");
        await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
        if (info.project.name === "celular") await page.locator("#btnRegions").click();
        await page.locator(".rl-row").first().click();
        await page.locator(".chart-table summary").click();
        await page.locator("#tlRange").fill("2");
        await page.waitForTimeout(400);
        const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
            .exclude(".leaflet-tile-pane")
            .analyze();
        const serious = results.violations
            .filter(v => v.impact === "serious" || v.impact === "critical")
            .map(v => ({ id: v.id, nodes: v.nodes.slice(0, 5).map(n => `${n.target.join(" ")} — ${n.failureSummary?.split("\n")[1] || ""}`) }));
        expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    });
}
