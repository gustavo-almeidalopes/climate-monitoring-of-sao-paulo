/*
 * PWA (Fase 4): service worker (abre sem rede, guarda a última leitura real) e inscrição em
 * alertas por notificação (Web Push) e WhatsApp, no painel do sino.
 *
 * Honestidade: o botão só promete o que o servidor oferece (GET /alerts/channels). Sem chaves
 * VAPID, sem permissão do navegador, ou no iPhone fora da Tela de Início, o painel diz o porquê.
 */
import { ApiError, alertsApi, type AlertChannels } from "./api.js";
import { $, $$, storage } from "./util.js";

const PREFS_KEY = "climasp_alert_prefs";

/** Registra o service worker (não em file:// nem nos testes que o bloqueiam). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return null;
    try {
        return await navigator.serviceWorker.register("sw.js", { scope: "./" });
    } catch (err) {
        console.warn("Service worker não registrado:", err);
        return null;
    }
}

/** VAPID em base64url -> bytes (formato exigido por pushManager.subscribe). */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
    const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
    const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
}

function isIos(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
    return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

function pushSupported(): boolean {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function setStatus(text: string, kind: "" | "ok" | "warn" = "") {
    const el = $("#alertSubStatus");
    el.textContent = text;
    el.className = `ah-sub-status ${kind}`;
}

function chosenRegions(): string[] {
    return $$<HTMLInputElement>('input[name="alertRegion"]').filter(i => i.checked).map(i => i.value);
}

function minLevel(): string {
    return $<HTMLSelectElement>("#alertMinLevel").value;
}

function restorePrefs() {
    const prefs = storage.get<{ regions: string[]; minLevel: string }>(PREFS_KEY, null);
    if (!prefs) return;
    $$<HTMLInputElement>('input[name="alertRegion"]').forEach(i => { i.checked = prefs.regions.includes(i.value); });
    $<HTMLSelectElement>("#alertMinLevel").value = prefs.minLevel;
}

async function currentSubscription(): Promise<PushSubscription | null> {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
}

function renderWhatsapp(channels: AlertChannels | null) {
    const el = $("#alertWhatsapp");
    if (!channels?.whatsapp || !channels.whatsapp_number) { el.hidden = true; return; }
    const digits = channels.whatsapp_number.replace(/\D/g, "");
    el.innerHTML = `Ou pelo WhatsApp: envie o nome da sua região para <a href="https://wa.me/${digits}?text=Santana" ` +
        `target="_blank" rel="noopener noreferrer">${channels.whatsapp_number}</a>. Envie SAIR para cancelar.`;
    el.hidden = false;
}

function setButton(subscribed: boolean, disabled = false) {
    const btn = $<HTMLButtonElement>("#alertSubBtn");
    btn.textContent = subscribed ? "Desativar notificações" : "Ativar notificações";
    btn.classList.toggle("off", subscribed);
    btn.disabled = disabled;
    btn.dataset.subscribed = String(subscribed);
}

async function subscribe(channels: AlertChannels) {
    const regions = chosenRegions();
    if (!regions.length) { setStatus("Escolha ao menos uma região.", "warn"); return; }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
        setStatus("Notificações bloqueadas neste navegador. Libere nas configurações do site para receber alertas.", "warn");
        return;
    }
    const reg = (await navigator.serviceWorker.getRegistration()) || (await registerServiceWorker());
    if (!reg) { setStatus("Este navegador não permite notificações em segundo plano.", "warn"); return; }
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: keyBytes(channels.vapid_public_key as string),
    });
    await alertsApi.subscribe(sub.toJSON(), regions, minLevel());
    storage.set(PREFS_KEY, { regions, minLevel: minLevel() });
    setButton(true);
    setStatus("Notificações ativadas. Você será avisado quando o risco subir.", "ok");
}

async function unsubscribe() {
    const sub = await currentSubscription();
    if (sub) {
        try { await alertsApi.unsubscribe(sub.endpoint); } catch (_) { /* apaga localmente mesmo assim */ }
        await sub.unsubscribe();
    }
    setButton(false);
    setStatus("Notificações desativadas. Sua inscrição foi apagada do servidor.");
}

export async function initPwa(): Promise<void> {
    void registerServiceWorker();
    restorePrefs();

    let channels: AlertChannels | null = null;
    try {
        channels = await alertsApi.channels();
    } catch (_) {
        channels = null; // servidor antigo ou fora do ar
    }
    renderWhatsapp(channels);

    if (!channels?.web_push) {
        setButton(false, true);
        setStatus(channels ? "Notificações ainda não configuradas neste servidor." : "Alertas indisponíveis sem conexão com o servidor.");
        return;
    }
    if (!pushSupported()) {
        setButton(false, true);
        setStatus(isIos() && !isStandalone()
            ? "No iPhone: toque em Compartilhar e em \"Adicionar à Tela de Início\"; depois abra o ClimaSP por lá para ativar."
            : "Este navegador não oferece notificações.", "warn");
        return;
    }
    setButton(!!(await currentSubscription()));

    $("#alertSubBtn").addEventListener("click", async () => {
        const btn = $<HTMLButtonElement>("#alertSubBtn");
        btn.disabled = true;
        try {
            if (btn.dataset.subscribed === "true") await unsubscribe();
            else await subscribe(channels as AlertChannels);
        } catch (err) {
            console.warn("Inscrição em alertas falhou:", err);
            setStatus(err instanceof ApiError && err.detail ? String(err.detail) : "Não foi possível ativar agora. Tente de novo.", "warn");
        } finally {
            btn.disabled = false;
        }
    });

    // mudar regiões ou nível com a inscrição ativa atualiza o servidor
    const resync = async () => {
        const sub = await currentSubscription();
        if (!sub || !chosenRegions().length) return;
        try {
            await alertsApi.subscribe(sub.toJSON(), chosenRegions(), minLevel());
            storage.set(PREFS_KEY, { regions: chosenRegions(), minLevel: minLevel() });
            setStatus("Preferências de alerta atualizadas.", "ok");
        } catch (_) {
            setStatus("Não foi possível atualizar as preferências agora.", "warn");
        }
    };
    $$('input[name="alertRegion"]').forEach(i => i.addEventListener("change", resync));
    $("#alertMinLevel").addEventListener("change", resync);
}
