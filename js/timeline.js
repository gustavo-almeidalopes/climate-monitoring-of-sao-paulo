/*
 * Linha do tempo do mapa: −24 h (observado) … agora … +48 h (previsto), com botão para animar.
 * Muda store.timeOffset; o mapa redesenha as zonas com os valores daquela hora
 * (previsto aparece hachurado com contorno tracejado).
 */
import { icon } from "./icons.js";
import { store } from "./state.js";
import { paintRange } from "./ui.js";
import { $, prefersReducedMotion } from "./util.js";
const MIN = -24;
const MAX = 48;
function label(offset, now) {
    if (offset === 0)
        return "Agora";
    const t = new Date(now);
    t.setMinutes(0, 0, 0);
    t.setHours(t.getHours() + offset);
    const today = new Date(now).toDateString() === t.toDateString();
    const tomorrow = new Date(now + 86_400_000).toDateString() === t.toDateString();
    const yesterday = new Date(now - 86_400_000).toDateString() === t.toDateString();
    const day = today ? "hoje" : tomorrow ? "amanhã" : yesterday ? "ontem" : t.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" });
    const hour = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return `${day} ${hour} · ${offset > 0 ? "previsto" : "observado"} (${offset > 0 ? "+" : "−"}${Math.abs(offset)} h)`;
}
export function initTimeline() {
    const range = $("#tlRange");
    const play = $("#tlPlay");
    const now = $("#tlNow");
    const out = $("#tlLabel");
    let timer = null;
    const setOffset = v => store.set({ timeOffset: Math.max(MIN, Math.min(MAX, Math.round(v))) });
    function stop() {
        if (timer)
            clearInterval(timer);
        timer = null;
        play.innerHTML = icon("play");
        play.setAttribute("aria-label", "Animar a evolução das zonas");
        play.setAttribute("aria-pressed", "false");
    }
    function start() {
        if (store.get().timeOffset >= MAX)
            setOffset(MIN);
        play.innerHTML = icon("pause");
        play.setAttribute("aria-label", "Pausar animação");
        play.setAttribute("aria-pressed", "true");
        timer = setInterval(() => {
            const next = store.get().timeOffset + 1;
            if (next > MAX) {
                stop();
                return;
            }
            setOffset(next);
        }, prefersReducedMotion() ? 1200 : 450);
    }
    range.addEventListener("input", () => { stop(); setOffset(Number(range.value)); });
    play.addEventListener("click", () => (timer ? stop() : start()));
    now.addEventListener("click", () => { stop(); setOffset(0); });
    store.subscribe(s => [s.timeOffset, s.now], ([offset, clock]) => {
        range.value = String(offset);
        paintRange(range);
        const text = label(offset, clock);
        out.textContent = text;
        range.setAttribute("aria-valuetext", text);
        now.disabled = offset === 0;
        $("#timeline").dataset.kind = offset === 0 ? "now" : offset > 0 ? "forecast" : "observed";
    });
    store.subscribe(s => [s.hasSeries, s.source], ([hasSeries, source]) => {
        const enabled = hasSeries && source === "live";
        $("#timeline").classList.toggle("disabled", !enabled);
        range.disabled = !enabled;
        play.disabled = !enabled;
        $("#tlHint").hidden = enabled;
        if (!enabled) {
            stop();
            if (store.get().timeOffset)
                setOffset(0);
        }
    });
    play.innerHTML = icon("play");
}
