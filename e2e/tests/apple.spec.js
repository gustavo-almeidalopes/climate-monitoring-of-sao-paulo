// Estilo Apple e sistema sem emojis: controle segmentado, controles deslizantes do iOS,
// destaque azul do sistema e texto de terceiros (RSS) sem emojis.
import { test, expect } from "@playwright/test";
import { mockNetwork, mockOps, overviewPayload } from "../support/mocks.js";

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}\u{2022}\u{FE0F}]/u;

async function open(page, { url = "/index.html", theme = "light", news } = {}) {
    await page.addInitScript(t => localStorage.setItem("climasp_theme", t), theme);
    await mockNetwork(page, { overview: () => overviewPayload({}, { updatedAt: new Date(Date.now() - 3 * 60e3) }), news });
    await mockOps(page, {});
    await page.goto(url);
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
}

test("notícias do RSS aparecem sem emojis", async ({ page }) => {
    await open(page, {
        news: {
            articles: [{
                source: "G1 SP 📰", title: "🌧️ Alagamento na Marginal ⚠️ trânsito parado ➡️ Santana",
                summary: "Chuva forte ☔ na Zona Norte • CGE em atenção", url: "https://g1.globo.com/x", relevance_score: 7,
                published_at: new Date().toISOString(),
            }],
            total: 1,
            last_scraped_at: new Date().toISOString(),
        },
    });
    await page.locator("#btnNews").click();
    const card = page.locator(".news-card").first();
    await expect(card).toContainText("Alagamento na Marginal trânsito parado Santana");
    expect(await card.innerText()).not.toMatch(EMOJI);
});

test("uma aba só vira título grande; com Operação, controle segmentado", async ({ page }, info) => {
    await open(page, { url: "/index.html?operador=1" });
    if (info.project.name === "celular") await page.locator("#btnRegions").click();
    const tabs = page.locator(".side-tabs");
    await expect(tabs).toHaveClass(/segmented/);
    const [active, idle] = await Promise.all([
        page.locator("#tabRegions").evaluate(el => getComputedStyle(el).backgroundColor),
        page.locator("#tabOps").evaluate(el => getComputedStyle(el).backgroundColor),
    ]);
    expect(active).toBe("rgb(255, 255, 255)"); // botão do segmento ativo no tema claro
    expect(idle).not.toBe(active);
    await page.locator("#tabOps").click();
    await expect(page.locator("#tabOps")).toHaveAttribute("aria-selected", "true");
});

test("cidadão: sem controle segmentado", async ({ page }) => {
    await open(page);
    await expect(page.locator(".side-tabs")).not.toHaveClass(/segmented/);
});

test("linha do tempo no estilo iOS: trilho preenchido acompanha o valor", async ({ page }) => {
    await open(page);
    const range = page.locator("#tlRange");
    // -24..48 com valor 0: 24/72 do trilho
    await expect(range).toHaveAttribute("style", /--fill:\s*33\.3/);
    await range.focus();
    for (let i = 0; i < 12; i++) await page.keyboard.press("ArrowRight");
    await expect(range).toHaveAttribute("style", /--fill:\s*50%/);
});

test("botão de busca usa o azul do sistema nos dois temas", async ({ page }) => {
    await open(page, { theme: "light" });
    expect(await page.locator("#searchBtn").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(0, 122, 255)");
    await page.locator("#btnTheme").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() => page.locator("#searchBtn").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(10, 132, 255)");
});
