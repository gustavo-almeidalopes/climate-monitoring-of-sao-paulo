/* Peças de interface sem estado de domínio: toast, tela de carregamento, anúncios. */
import { icon } from "./icons.js";
import { $ } from "./util.js";

const LOADING_STATES = {
    init: { text: "Carregando mapa e dados…", sub: "Conectando ao servidor do ClimaSP", icon: "cloud-rain" },
    weather: { text: "Lendo dados climáticos…", sub: "Chuva, temperatura e risco por subprefeitura", icon: "thermometer" },
    map: { text: "Montando o mapa…", sub: "Carregando camadas do mapa base", icon: "map" },
    districts: { text: "Desenhando as regiões…", sub: "Perímetros dos distritos monitorados", icon: "layers" },
};

export function setLoadingState(state) {
    const msg = LOADING_STATES[state] || LOADING_STATES.init;
    $("#loadingMsg").textContent = msg.text;
    $("#mapLoading .load-sub").textContent = msg.sub;
    $("#mapLoading .load-logo").innerHTML = icon(msg.icon);
}

export function hideLoading() {
    $("#mapLoading").hidden = true;
}

export function showMapError() {
    $("#mapLoading").hidden = true;
    $("#mapError").hidden = false;
}

export function showToast(message) {
    $("#toastMsg").textContent = message;
    $("#toast").classList.add("show");
}

export function hideToast() {
    $("#toast").classList.remove("show");
}

/** Texto para leitores de tela (região aria-live="assertive"). */
export function announce(message) {
    const node = $("#srAnnouncer");
    node.textContent = "";
    // reatribuir num próximo quadro garante que a mesma frase seja lida de novo
    requestAnimationFrame(() => { node.textContent = message; });
}

export function initUi() {
    $("#toastClose").addEventListener("click", hideToast);
    $("#btnRetryMap").addEventListener("click", () => window.location.reload());

    // Painel de camadas: recolhido por padrão (exceto em telas muito largas) para não cobrir o mapa.
    const panel = $("#controlPanel");
    const toggle = $("#cpToggle");
    const setCollapsed = collapsed => {
        panel.classList.toggle("collapsed", collapsed);
        toggle.setAttribute("aria-expanded", String(!collapsed));
    };
    setCollapsed(!window.matchMedia("(min-width: 1600px)").matches);
    toggle.addEventListener("click", () => setCollapsed(!panel.classList.contains("collapsed")));

    // Legenda: recolhível; começa fechada no celular para não cobrir o mapa.
    const legend = $("#floodLegend");
    const legToggle = $("#legToggle");
    const setLegend = open => {
        legend.classList.toggle("collapsed", !open);
        legToggle.setAttribute("aria-expanded", String(open));
    };
    setLegend(!window.matchMedia("(max-width: 768px)").matches);
    legToggle.addEventListener("click", () => setLegend(legend.classList.contains("collapsed")));
}
