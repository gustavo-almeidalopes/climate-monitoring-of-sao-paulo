import { test, expect } from "@playwright/test";
import { mockNetwork, currentPayload } from "../support/mocks.js";

test("carrega sem erros de console", async ({ page }) => {
    const errors = [];
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", e => errors.push(String(e)));
    await mockNetwork(page, { current: currentPayload({ ST: { rain: 24.5, risk: 72 } }) });
    await page.goto("/index.html");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#statusLabel")).toHaveText("Ao vivo");
    expect(errors).toEqual([]);
});
