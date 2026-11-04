/*
 * Faixa de alerta com memória por nível + histórico de alertas (ícone de sino).
 *
 * Memória: fechar a faixa guarda { level, ids } na sessão. Ela reaparece se o
 * nível piorar (ex.: Alto → Crítico) ou se outra região entrar no mesmo nível.
 * Se a situação melhorar, a memória acompanha a queda — assim uma nova piora
 * volta a alertar. Abaixo de "Alto" a memória é apagada.
 *
 * Histórico: cada mudança de nível de uma região, observada com dado real,
 * vira uma entrada (guardada neste navegador, até 50 entradas).
 * Dados de exemplo nunca geram alerta nem histórico.
 */
import { icon } from "./icons.js";
import { LEVELS, levelOf, levelRank } from "./risk.js";
import { effectiveThresholds, store } from "./state.js";
import { announce } from "./ui.js";
import { $, escapeHtml, fmt1, fmtDateTime, storage, timeAgo } from "./util.js";

const HISTORY_KEY = "climasp_alert_history";
const LAST_LEVELS_KEY = "climasp_alert_last_levels";
const SEEN_KEY = "climasp_alert_seen_at";
const DISMISS_KEY = "climasp_alert_dismissed";
const MAX_HISTORY = 50;
const ALERT_MIN_RANK = LEVELS.high.rank;

let lastAnnounced = "";

/** Situação atual de alerta: nível mais grave (≥ Alto) e regiões nesse nível. */
function currentAlert(state) {
    if (state.source !== "live") return null;
    const thresholds = effectiveThresholds(state);
    let worst = null;
    for (const region of Object.values(state.regions)) {
        const d = levelOf(region, thresholds);
        if (d.rank < ALERT_MIN_RANK) continue;
        if (!worst || d.rank > worst.danger.rank) worst = { danger: d, regions: [region] };
        else if (d.rank === worst.danger.rank) worst.regions.push(region);
    }
    return worst;
}

/** Ajusta a memória de "alerta fechado" à situação atual. Devolve a memória atualizada. */
export function reconcileDismissal(dismissed, alert) {
    if (!dismissed) return null;
    if (!alert) return null;
    const rank = alert.danger.rank;
    const dismissedRank = levelRank(dismissed.level);
    if (rank > dismissedRank) return null; // piorou: alerta volta
    const ids = alert.regions.map(r => r.id);
    if (rank === dismissedRank && ids.some(id => !dismissed.ids.includes(id))) return null; // nova região
    if (rank < dismissedRank) return { level: alert.danger.level, ids }; // melhorou: acompanha a queda
    return dismissed;
}

function alertMessage(alert) {
    const names = alert.regions.map(r => `${r.short} (${fmt1(r.rain)} mm/h)`).join(", ");
    const byRain = alert.danger.reason === "chuva observada na última hora";
    const cause = byRain ? "chuva" : "chuva acumulada e previsão de chuva forte";
    if (alert.danger.level === "critical") {
        return {
            title: "ALERTA CRÍTICO:",
            text: `${byRain ? "chuva intensa" : cause} em ${names}. Risco elevado de alagamento — evite áreas de várzea.`,
        };
    }
    return { title: "ATENÇÃO:", text: `${byRain ? "chuva forte" : cause} em ${names}. Monitore as condições e evite áreas de risco.` };
}

function renderStrip(state) {
    const strip = $("#alertStrip");
    if (state.source !== "live") {
        // sem dado real não há alerta; a memória da sessão fica intacta
        strip.classList.remove("show");
        strip.hidden = true;
        return;
    }
    const alert = currentAlert(state);
    const dismissed = reconcileDismissal(state.alertDismissed, alert);
    if (dismissed !== state.alertDismissed) {
        // ajuste vindo dos dados, não do usuário; o set reentra e re-renderiza
        storage.set(DISMISS_KEY, dismissed, "session");
        store.set({ alertDismissed: dismissed });
        return;
    }
    if (!alert || dismissed) {
        strip.classList.remove("show");
        strip.hidden = true;
        if (!alert) lastAnnounced = "";
        return;
    }
    const msg = alertMessage(alert);
    $("#alertText").innerHTML = `<strong>${escapeHtml(msg.title)}</strong> ${escapeHtml(msg.text)}`;
    strip.className = `alert-strip level-${alert.danger.level} show`;
    strip.hidden = false;
    const spoken = `${msg.title} ${msg.text}`;
    if (spoken !== lastAnnounced) {
        lastAnnounced = spoken;
        announce(spoken);
    }
}

/** Registra mudanças de nível de cada região (só com dado real). */
function recordTransitions(state) {
    if (state.source !== "live") return;
    const thresholds = effectiveThresholds(state);
    const last = storage.get(LAST_LEVELS_KEY, {}) || {};
    const entries = [];
    const now = Date.now();
    for (const region of Object.values(state.regions)) {
        const to = levelOf(region, thresholds).level;
        const from = last[region.id] || null;
        if (from === to) continue;
        // primeira observação neste navegador: só vira entrada se já estiver em alerta
        if (from || levelRank(to) >= ALERT_MIN_RANK) {
            entries.push({ t: now, id: region.id, short: region.short, from, to, rain: region.rain, risk: region.risk });
        }
        last[region.id] = to;
    }
    storage.set(LAST_LEVELS_KEY, last);
    if (!entries.length) return;
    const history = [...entries, ...state.alertHistory].slice(0, MAX_HISTORY);
    storage.set(HISTORY_KEY, history);
    store.set({ alertHistory: history });
}

function renderHistory([history, seenAt, now]) {
    const unread = history.filter(e => e.t > seenAt).length;
    const badge = $("#alertUnread");
    badge.textContent = unread > 9 ? "9+" : String(unread);
    badge.hidden = unread === 0;
    $("#btnAlerts").setAttribute(
        "aria-label",
        unread ? `Histórico de alertas, ${unread} ${unread === 1 ? "novo" : "novos"}` : "Histórico de alertas",
    );

    const list = $("#alertHistoryList");
    $("#alertHistoryClear").hidden = history.length === 0;
    if (!history.length) {
        list.innerHTML =
            '<li class="ah-empty">Nenhuma mudança de nível registrada ainda. ' +
            "As mudanças aparecem aqui conforme os dados reais chegam.</li>";
        return;
    }
    list.innerHTML = history.map(e => {
        const to = LEVELS[e.to] || LEVELS.low;
        const from = e.from ? LEVELS[e.from] : null;
        const change = from ? `${from.label} → ${to.label}` : `entrou em ${to.label}`;
        const worse = !from || to.rank > from.rank;
        return `<li class="ah-item ${e.t > seenAt ? "unread" : ""}">
            <span class="ah-sym lvl-${to.level}" aria-hidden="true">${to.symbol}</span>
            <div class="ah-body">
                <div class="ah-title">${escapeHtml(e.short)}: ${escapeHtml(change)}
                    <span class="sr-only">${worse ? "(piorou)" : "(melhorou)"}</span></div>
                <div class="ah-meta">${fmt1(e.rain)} mm/h · risco ${e.risk ?? "—"}/100</div>
                <div class="ah-time"><time datetime="${new Date(e.t).toISOString()}">${fmtDateTime(e.t)}</time> · ${timeAgo(e.t, now)}</div>
            </div>
        </li>`;
    }).join("");
}

function initHistoryPanel() {
    const btn = $("#btnAlerts");
    const panel = $("#alertHistory");
    btn.innerHTML = icon("bell") + btn.innerHTML;

    const setOpen = open => {
        panel.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
        if (open) {
            const seenAt = Date.now();
            // marca como lido só ao fechar, para o destaque continuar visível enquanto o painel está aberto
            panel.dataset.seenAt = String(seenAt);
            $("#alertHistoryClose").focus();
        } else if (panel.dataset.seenAt) {
            const seenAt = Number(panel.dataset.seenAt);
            delete panel.dataset.seenAt;
            storage.set(SEEN_KEY, seenAt);
            store.set({ alertSeenAt: seenAt });
        }
    };
    btn.addEventListener("click", () => setOpen(panel.hidden));
    $("#alertHistoryClose").addEventListener("click", () => { setOpen(false); btn.focus(); });
    $("#alertHistoryClear").addEventListener("click", () => {
        storage.set(HISTORY_KEY, []);
        store.set({ alertHistory: [] });
        btn.focus();
    });
    document.addEventListener("keydown", e => {
        if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); }
    });
    document.addEventListener("click", e => {
        if (!panel.hidden && !e.target.closest("#alertHistory") && !e.target.closest("#btnAlerts")) setOpen(false);
    });
}

export function initAlerts() {
    const history = storage.get(HISTORY_KEY, []);
    store.set({
        alertHistory: Array.isArray(history) ? history.slice(0, MAX_HISTORY) : [],
        alertSeenAt: Number(storage.get(SEEN_KEY, 0)) || 0,
        alertDismissed: storage.get(DISMISS_KEY, null, "session"),
    });

    initHistoryPanel();
    $("#alertClose").addEventListener("click", () => {
        const alert = currentAlert(store.get());
        if (!alert) return;
        const dismissed = { level: alert.danger.level, ids: alert.regions.map(r => r.id) };
        storage.set(DISMISS_KEY, dismissed, "session");
        store.set({ alertDismissed: dismissed });
    });

    store.subscribe(s => s.regions, () => recordTransitions(store.get()));
    store.subscribe(s => [s.regions, s.source, effectiveThresholds(s), s.alertDismissed], () => renderStrip(store.get()));
    store.subscribe(s => [s.alertHistory, s.alertSeenAt, s.now], renderHistory);
}
