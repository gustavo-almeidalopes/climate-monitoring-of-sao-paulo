/*
 * Ponto de entrada do front-end do ClimaSP (módulos ES nativos, sem build).
 *
 * Fluxo de dados: weather.js grava no store → cada módulo assina a fatia de
 * estado que exibe (mapa, cartões, alertas, banner, legenda, busca) e se
 * redesenha sozinho. Não há chamadas de render manuais entre módulos.
 */
import { initAlerts } from "./alerts.js";
import { initMap } from "./map.js";
import { initNews } from "./news.js";
import { initOperator } from "./operator.js";
import { initSearch } from "./search.js";
import { initStatus } from "./status.js";
import { initTheme } from "./theme.js";
import { initTooltips } from "./tooltips.js";
import { initUi, setLoadingState, showMapError } from "./ui.js";
import { initAutoRefresh, loadThresholds, loadWeather } from "./weather.js";

async function start() {
    // Partes que funcionam mesmo se o mapa falhar.
    initTheme();
    initTooltips();
    initUi();
    initStatus();
    initAlerts();
    initOperator();
    initNews();

    setLoadingState("weather");
    await loadThresholds();
    await loadWeather();
    initAutoRefresh();

    if (typeof window.L === "undefined") {
        showMapError();
        return;
    }
    setLoadingState("map");
    const mapApi = initMap();
    initSearch(mapApi);
}

start().catch(err => {
    console.error("Falha ao inicializar o ClimaSP:", err);
    showMapError();
});
