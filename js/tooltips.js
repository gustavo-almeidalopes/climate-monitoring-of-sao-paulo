/*
 * Dicas flutuantes para elementos com [data-tip].
 * Um único nó posicionado por JS: a barra de cartões e os popups do Leaflet
 * cortam o overflow, então uma dica aninhada seria cortada.
 */
let node = null;
let current = null;

const el = () => node || (node = document.getElementById("globalTooltip"));

function place(trigger) {
    const t = el();
    const r = trigger.getBoundingClientRect();
    const gap = 10;
    let left = r.left + r.width / 2 - t.offsetWidth / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - t.offsetWidth - 8));
    let top = r.top - t.offsetHeight - gap;
    if (top < 8) top = r.bottom + gap;
    t.style.left = `${Math.round(left)}px`;
    t.style.top = `${Math.round(top)}px`;
}

function show(trigger) {
    const t = el();
    const text = trigger.getAttribute("data-tip");
    if (!t || !text) return;
    current = trigger;
    t.textContent = text;
    t.classList.add("show");
    trigger.setAttribute("aria-describedby", "globalTooltip");
    place(trigger);
}

export function hideTooltip() {
    const t = el();
    if (!t) return;
    t.classList.remove("show");
    if (current) current.removeAttribute("aria-describedby");
    current = null;
}

const triggerOf = target => (target && target.closest ? target.closest("[data-tip]") : null);

export function initTooltips() {
    document.addEventListener("mouseover", e => {
        const trigger = triggerOf(e.target);
        if (trigger && trigger !== current) show(trigger);
    });
    document.addEventListener("mouseout", e => {
        if (current && triggerOf(e.target) === current) hideTooltip();
    });
    document.addEventListener("focusin", e => {
        const trigger = triggerOf(e.target);
        if (trigger) show(trigger);
    });
    document.addEventListener("focusout", hideTooltip);
    document.addEventListener("keydown", e => { if (e.key === "Escape") hideTooltip(); });
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("resize", hideTooltip);
}
