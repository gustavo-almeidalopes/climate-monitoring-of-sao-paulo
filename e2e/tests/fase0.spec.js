// Comportamentos corrigidos na Fase 0 (itens 4 a 10 da lista de problemas).
import { test, expect } from "@playwright/test";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { mockNetwork, currentPayload } from "../support/mocks.js";

const require = createRequire(import.meta.url);

async function open(page, opts = {}, url = "/index.html") {
    const net = await mockNetwork(page, opts);
    await page.goto(url);
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    return net;
}

/** Cenário mutável: os testes trocam `values` e clicam em "Atualizar". */
function scenario(values) {
    const s = { values };
    s.current = () => currentPayload(s.values);
    return s;
}

const refresh = async page => {
    await page.locator("#btnRefresh").click();
    await expect(page.locator("#statusLabel")).not.toHaveText("Atualizando…");
};

test.describe("modo offline (item 4)", () => {
    test("com servidor no ar não há banner nem etiqueta de exemplo", async ({ page }) => {
        await open(page, { current: currentPayload({ ST: { rain: 3 } }) });
        await expect(page.locator("#statusLabel")).toHaveText("Ao vivo");
        await expect(page.locator("#connBanner")).toBeHidden();
        await expect(page.locator(".sample-tag")).toHaveCount(0);
        await expect(page.locator("body")).not.toHaveClass(/is-sample/);
    });

    test("sem servidor: banner explícito, valores marcados como exemplo e nenhum alerta", async ({ page }) => {
        await open(page, { apiDown: true });
        const banner = page.locator("#connBanner");
        await expect(banner).toBeVisible();
        await expect(banner).toContainText(
            "Sem conexão com o servidor — exibindo dados de exemplo, não use para decisões.");
        await expect(page.locator("body")).toHaveClass(/is-sample/);
        await expect(page.locator("#statRain .sample-tag")).toHaveText("exemplo");
        await expect(page.locator("#statRain")).toHaveClass(/is-sample/);
        await expect(page.locator("#statUpdated")).toHaveText("sem conexão");
        await expect(page.locator("#alertStrip")).toBeHidden();
        await expect(page.locator("#alertUnread")).toBeHidden();
        expect(await page.locator("path.zone-sample").count()).toBeGreaterThan(0);
        await expect(page.locator("#legNote")).toContainText("dados de exemplo");
    });

    test("conexão perdida depois de dado real mantém a última leitura, sem virar exemplo", async ({ page }) => {
        const net = await open(page, { current: currentPayload({ ST: { rain: 12.3 } }) });
        net.apiDown = true;
        await refresh(page);
        await expect(page.locator("#statusLabel")).toHaveText("Sem conexão");
        await expect(page.locator("#connBanner")).toContainText("Conexão perdida.");
        await expect(page.locator("#connBanner")).toContainText("última leitura real");
        await expect(page.locator("#statRain")).toContainText("12,3");
        await expect(page.locator(".sample-tag")).toHaveCount(0);
        net.apiDown = false;
        await page.locator("#connRetry").click();
        await expect(page.locator("#connBanner")).toBeHidden();
        await expect(page.locator("#statusLabel")).toHaveText("Ao vivo");
    });
});

test.describe("alertas com memória (item 5)", () => {
    test("Alto fechado não volta igual, mas Crítico reaparece", async ({ page }) => {
        const s = scenario({ ST: { rain: 25, risk: 70 } });
        await open(page, { current: s.current });
        const strip = page.locator("#alertStrip");
        await expect(strip).toBeVisible();
        await expect(strip).toContainText("ATENÇÃO");
        await expect(strip).toContainText("Santana");

        await page.locator("#alertClose").click();
        await expect(strip).toBeHidden();
        await refresh(page);
        await expect(strip).toBeHidden();

        s.values = { ST: { rain: 45, risk: 90 } };
        await refresh(page);
        await expect(strip).toBeVisible();
        await expect(strip).toContainText("ALERTA CRÍTICO");
        await expect(page.locator("#srAnnouncer")).toContainText("ALERTA CRÍTICO");
    });

    test("reaparece quando outra região entra no mesmo nível", async ({ page }) => {
        const s = scenario({ ST: { rain: 25 } });
        await open(page, { current: s.current });
        await page.locator("#alertClose").click();
        s.values = { ST: { rain: 25 }, CV: { rain: 22 } };
        await refresh(page);
        await expect(page.locator("#alertStrip")).toBeVisible();
        await expect(page.locator("#alertStrip")).toContainText("Casa Verde");
    });

    test("se melhora e volta a piorar, alerta de novo", async ({ page }) => {
        const s = scenario({ ST: { rain: 45 } });
        await open(page, { current: s.current });
        await page.locator("#alertClose").click();
        s.values = { ST: { rain: 25 } }; // Crítico → Alto: segue fechado
        await refresh(page);
        await expect(page.locator("#alertStrip")).toBeHidden();
        s.values = { ST: { rain: 2 } }; // passa
        await refresh(page);
        s.values = { ST: { rain: 25 } }; // nova chuva forte
        await refresh(page);
        await expect(page.locator("#alertStrip")).toBeVisible();
    });

    test("histórico no sino registra as mudanças de nível", async ({ page }) => {
        const s = scenario({ ST: { rain: 25 } });
        await open(page, { current: s.current });
        s.values = { ST: { rain: 45 } };
        await refresh(page);
        await expect(page.locator("#alertUnread")).toHaveText("2");
        await page.locator("#btnAlerts").click();
        const panel = page.locator("#alertHistory");
        await expect(panel).toBeVisible();
        await expect(panel.locator(".ah-item").first()).toContainText("Santana: Alto → Crítico");
        await expect(panel.locator(".ah-item")).toHaveCount(2);
        await page.keyboard.press("Escape");
        await expect(panel).toBeHidden();
        await expect(page.locator("#alertUnread")).toBeHidden();
    });
});

test.describe("busca (itens 7 e 8)", () => {
    test("texto do Nominatim é escapado e o pino mostra o risco da região", async ({ page }) => {
        await open(page, {
            current: currentPayload({ ST: { rain: 25, risk: 70 } }),
            nominatim: [{
                lat: "-23.4985", lon: "-46.6290",
                display_name: '<img src=x onerror="window.__xss=1">Rua Voluntários da Pátria, Santana, São Paulo',
            }],
        });
        await page.locator("#searchInput").fill("Voluntários da Pátria");
        await page.locator("#searchBtn").click();
        const popup = page.locator(".leaflet-popup-content .ps");
        await expect(popup).toBeVisible();
        await expect(popup).toContainText('<img src=x onerror="window.__xss=1">Rua Voluntários da Pátria');
        await expect(popup.locator("img")).toHaveCount(0);
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        await expect(popup).toContainText("Alto");
        await expect(popup).toContainText("25,0 mm/h");
        await expect(popup).toContainText("Subprefeitura Santana/Tucuruvi");
    });

    test("ponto fora da Zona Norte é identificado como fora da área monitorada", async ({ page }) => {
        await open(page, { nominatim: [{ lat: "-23.5614", lon: "-46.6559", display_name: "Avenida Paulista, Bela Vista, São Paulo" }] });
        await page.locator("#searchInput").fill("Av. Paulista");
        await page.locator("#searchInput").press("Enter");
        const popup = page.locator(".leaflet-popup-content .ps");
        await expect(popup).toContainText("Fora da área monitorada");
        await expect(popup).toContainText("Região monitorada mais próxima");
    });
});

test.describe("mapa base e tema (item 9)", () => {
    test("o mapa base automático acompanha o tema", async ({ page }) => {
        await page.addInitScript(() => localStorage.setItem("climasp_theme", "dark"));
        await open(page);
        const map = page.locator("#map");
        await expect(map).toHaveAttribute("data-basemap", "dark");
        await expect(page.locator(".leaflet-tile-pane img").first()).toHaveAttribute("src", /dark_all/);
        await page.locator("#btnTheme").click();
        await expect(map).toHaveAttribute("data-basemap", "light");
        await expect(page.locator(".leaflet-tile-pane img").first()).toHaveAttribute("src", /light_all/);
    });

    test("escolha manual do usuário prevalece sobre o tema", async ({ page }) => {
        await open(page);
        if (await page.locator("#controlPanel.collapsed").count()) await page.locator("#cpToggle").click();
        await page.locator('.lp-row[data-base="satellite"]').click();
        await expect(page.locator("#map")).toHaveAttribute("data-basemap", "satellite");
        await page.locator("#btnTheme").click();
        await expect(page.locator("#map")).toHaveAttribute("data-basemap", "satellite");
        await expect(page.locator('.lp-row[data-base="satellite"]')).toHaveAttribute("aria-checked", "true");
    });
});

test.describe("modo operador (item 10)", () => {
    test("limiares ficam ocultos para o cidadão", async ({ page }) => {
        await open(page);
        await expect(page.locator("#thresholdSect")).toBeHidden();
        await expect(page.locator("#operatorChip")).toBeHidden();
    });

    test("?operador=1 mostra os limiares; ajuste local é sinalizado e reversível", async ({ page }) => {
        await open(page, { current: currentPayload({ ST: { rain: 32 } }) }, "/index.html?operador=1");
        if (await page.locator("#controlPanel.collapsed").count()) await page.locator("#cpToggle").click();
        await expect(page.locator("#operatorChip")).toBeVisible();
        await expect(page.locator("#thresholdSect")).toBeVisible();
        await expect(page.locator("#alertStrip")).toContainText("ATENÇÃO");

        await page.locator("#thrRed").fill("30");
        await page.locator("#thrApply").click();
        await expect(page.locator("#leg-red")).toHaveText("≥ 30 mm/h");
        await expect(page.locator("#alertStrip")).toContainText("ALERTA CRÍTICO");
        await expect(page.locator("#legNote")).toContainText("Limiares locais");
        await expect(page.locator("#operatorChipLocal")).toBeAttached();

        // A sessão lembra o modo; os limiares locais persistem neste navegador.
        await page.goto("/index.html");
        await expect(page.locator("#operatorChip")).toBeVisible();
        await expect(page.locator("#leg-red")).toHaveText("≥ 30 mm/h");

        await page.locator("#operatorExit").click();
        await expect(page.locator("#operatorChip")).toBeHidden();
        await expect(page.locator("#thresholdSect")).toBeHidden();
        await expect(page.locator("#leg-red")).toHaveText("≥ 40 mm/h");
        await expect(page.locator("#alertStrip")).toContainText("ATENÇÃO");
    });
});

test.describe("fundação", () => {
    test("zoom com os dedos liberado (item 6)", async ({ page }) => {
        await open(page);
        const viewport = await page.locator('meta[name="viewport"]').getAttribute("content");
        expect(viewport).not.toContain("user-scalable=no");
        expect(viewport).not.toContain("maximum-scale");
    });

    test("Leaflet com versão fixa e SRI que confere com o pacote oficial", async ({ page }) => {
        await open(page);
        const dist = path.dirname(require.resolve("leaflet/dist/leaflet.js"));
        const sri = f => "sha256-" + crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, f))).digest("base64");
        await expect(page.locator('script[src*="leaflet@1.9.4/dist/leaflet.js"]')).toHaveAttribute("integrity", sri("leaflet.js"));
        await expect(page.locator('link[href*="leaflet@1.9.4/dist/leaflet.css"]')).toHaveAttribute("integrity", sri("leaflet.css"));
    });

    test("sem emojis como ícones na interface", async ({ page }) => {
        await open(page, { apiDown: true });
        // Emojis (🌧️ 🛰️ 📰 …). Os símbolos de nível ⚠ ▲ → ✓ são texto e continuam.
        const html = await page.content();
        expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2B1B}]/u);
    });

    test("sem rolagem horizontal da página", async ({ page }) => {
        await open(page, { apiDown: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(0);
    });

    test("textos relativos de idade do dado", async ({ page }) => {
        await open(page, { current: currentPayload({}, new Date(Date.now() - 7 * 60_000)) });
        await expect(page.locator("#statUpdated")).toContainText("há 7 min");
    });
});

test.describe("notícias e tema", () => {
    test("gaveta de notícias escapa título e resumo vindos do RSS", async ({ page }) => {
        await open(page, {
            news: {
                articles: [{
                    source: "G1 SP", title: '<script>window.__xss=1</script>Alagamento na Marginal',
                    summary: "<b>Trânsito</b> lento", url: "javascript:alert(1)", relevance_score: 7,
                    published_at: new Date().toISOString(),
                }],
                total: 1,
                last_scraped_at: new Date().toISOString(),
            },
        });
        await page.locator("#btnNews").click();
        const card = page.locator(".news-card").first();
        await expect(card).toContainText("<script>window.__xss=1</script>Alagamento na Marginal");
        await expect(card).toHaveAttribute("href", "#");
        expect(await page.evaluate(() => window.__xss)).toBeUndefined();
        await expect(page.locator("#btnNews")).toHaveAttribute("aria-expanded", "true");
        await page.locator("#newsClose").click();
        await expect(page.locator("#btnNews")).toHaveAttribute("aria-expanded", "false");
    });

    test("tema escolhido é lembrado entre recargas", async ({ page }) => {
        await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("climasp_theme", "dark"); sessionStorage.setItem("seeded", "1"); } });
        await open(page);
        await page.locator("#btnTheme").click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await expect(page.locator("#map")).toHaveAttribute("data-basemap", "light");
    });
});

test("sugestões não reabrem depois de buscar logo após digitar", async ({ page }) => {
    await open(page, { nominatim: [{ lat: "-23.4985", lon: "-46.6290", display_name: "Rua X, Santana" }] });
    await page.locator("#searchInput").fill("Rua X");
    await page.locator("#searchBtn").click();
    await expect(page.locator(".leaflet-popup-content .ps")).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page.locator("#searchSuggestions")).not.toHaveClass(/show/);
});
