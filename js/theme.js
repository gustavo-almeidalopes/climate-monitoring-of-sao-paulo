/* Tema claro/escuro: segue o sistema até o usuário escolher; a escolha é lembrada. */
import { store } from "./state.js";
import { $, prefersReducedMotion, safely } from "./util.js";

const THEME_KEY = "climasp_theme"; // texto puro ("light"/"dark"), lido também pelo script inline do index.html
const readSaved = () => safely(() => localStorage.getItem(THEME_KEY), null);

function apply(theme, animate) {
    const html = document.documentElement;
    if (animate && !prefersReducedMotion()) {
        html.classList.add("theme-switching");
        setTimeout(() => html.classList.remove("theme-switching"), 420);
    }
    html.setAttribute("data-theme", theme);
    html.style.colorScheme = theme;
    const dark = theme !== "light";
    $("#iconMoon").style.display = dark ? "none" : "";
    $("#iconSun").style.display = dark ? "" : "none";
    const btn = $("#btnTheme");
    btn.setAttribute("aria-pressed", String(!dark));
    btn.title = dark ? "Mudar para tema claro" : "Mudar para tema escuro";
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
        meta.removeAttribute("media");
        meta.setAttribute("content", dark ? "#000000" : "#F2F2F7");
    });
}

export function initTheme() {
    let first = true;
    store.subscribe(s => s.theme, theme => { apply(theme, !first); first = false; });

    $("#btnTheme").addEventListener("click", () => {
        const next = store.get().theme === "light" ? "dark" : "light";
        safely(() => localStorage.setItem(THEME_KEY, next), null);
        store.set({ theme: next });
    });

    const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;
    if (media && media.addEventListener) {
        media.addEventListener("change", e => {
            const saved = readSaved();
            if (saved !== "light" && saved !== "dark") store.set({ theme: e.matches ? "light" : "dark" });
        });
    }
}
