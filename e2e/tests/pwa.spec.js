// Fase 4: PWA — instalável, abre sem rede com a última leitura REAL (sinalizada), e inscrição
// em alertas por notificação e WhatsApp. Aqui o service worker fica ligado (no resto, bloqueado).
import { test, expect } from "@playwright/test";
import { mockNetwork, overviewPayload } from "../support/mocks.js";

test.use({ serviceWorkers: "allow" });

// chave pública VAPID de teste (P-256, sem a privada: nada é enviado)
const VAPID = "BO3Y-lkK_AQqqJsu00Z2XfsBOiX2IPbrLJiWBOhsOP3OL6gK_CbpQzkShGUDda9z5hh7G7kQ86G-G698oUzWNfE";
const UPDATED = new Date(Date.now() - 4 * 60_000);

async function open(page, context, opts = {}) {
    // rotas no CONTEXTO: assim também valem para as requisições feitas pelo service worker
    const net = await mockNetwork(context, {
        overview: () => overviewPayload({ ST: { rain: 24.5, risk: 62 } }, { updatedAt: UPDATED }), ...opts,
    });
    await page.goto("/index.html");
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    return net;
}

test("instalável: manifesto em pt-BR, ícones e service worker controlando a página", async ({ page, context }) => {
    await open(page, context);
    const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
    expect(manifest.lang).toBe("pt-BR");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons.some(i => i.purpose === "maskable")).toBe(true);
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/$/);
});

test("sem rede, abre com a última leitura real e avisa 'Conexão perdida' (nunca 'Ao vivo')", async ({ page, context }) => {
    const net = await open(page, context);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    // segunda carga já controlada pelo service worker: a leitura real fica guardada
    await page.reload();
    await expect(page.locator("#statusLabel")).toHaveText("Ao vivo");
    await expect.poll(() => page.evaluate(async () => {
        const keys = await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(r => r.url)));
        return keys.flat().some(u => u.endsWith("/api/v1/weather/overview"));
    })).toBe(true);

    net.apiAbort = true;
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator("#mapLoading")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#statusLabel")).toHaveText("Sem conexão");
    await expect(page.locator("#connBanner")).toHaveAttribute("data-kind", "stale");
    await expect(page.locator("#connBannerTitle")).toHaveText("Conexão perdida.");
    await expect(page.locator("#connBannerText")).toContainText("última leitura real");
    await expect(page.locator("#statRain")).toContainText("24,5"); // número real, não o de exemplo
    await expect(page.locator("body")).not.toHaveClass(/is-sample/);
    await context.setOffline(false);
});

test("servidor sem notificações configuradas: o painel diz o porquê", async ({ page, context }) => {
    await open(page, context);
    await page.locator("#btnAlerts").click();
    await expect(page.locator("#alertSubStatus")).toHaveText("Notificações ainda não configuradas neste servidor.");
    await expect(page.locator("#alertSubBtn")).toBeDisabled();
    await expect(page.locator("#alertWhatsapp")).toBeHidden();
});

test("inscrição em notificações envia regiões e nível; WhatsApp com link wa.me", async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);
    // o Chromium de teste não tem serviço de push: simula a inscrição devolvida pelo navegador
    await context.addInitScript(() => {
        const fake = { endpoint: "https://push.example.test/abc", unsubscribe: async () => true,
            toJSON: () => ({ endpoint: "https://push.example.test/abc", keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) } }) };
        let current = null;
        PushManager.prototype.subscribe = async function () { current = fake; return fake; };
        PushManager.prototype.getSubscription = async function () { return current; };
    });
    const net = await open(page, context, {
        alerts: { web_push: true, vapid_public_key: VAPID, whatsapp: true, whatsapp_number: "+55 11 99999-0000" },
    });
    await page.locator("#btnAlerts").click();
    await expect(page.locator("#alertWhatsapp")).toContainText("+55 11 99999-0000");
    await expect(page.locator("#alertWhatsapp a")).toHaveAttribute("href", /^https:\/\/wa\.me\/5511999990000/);

    await page.locator('label.ah-chip:has(input[value="CV"])').click(); // desmarca Casa Verde
    await page.locator("#alertMinLevel").selectOption("critical");
    await page.locator("#alertSubBtn").click();
    await expect(page.locator("#alertSubStatus")).toHaveText(/Notificações ativadas/);
    await expect(page.locator("#alertSubBtn")).toHaveText("Desativar notificações");
    expect(net.subscriptions.at(-1)).toMatchObject({ regions: ["ST", "JT", "MG"], min_level: "critical",
        subscription: { endpoint: "https://push.example.test/abc" } });
});
