/*
 * Ponto de entrada do front-end do ClimaSP (módulos ES nativos, sem build).
 *
 * Fluxo de dados: weather.js grava no store e cada módulo assina a fatia de
 * estado que exibe (veredito, lista, detalhe, mapa, alertas, banner, legenda,
 * busca, linha do tempo) e se redesenha sozinho. Não há chamadas de render
 * manuais entre módulos.
 */
import { initAlerts } from "./alerts.js";
import { initDevLog } from "./devlog.js";
import { initGeolocate } from "./geolocate.js";
import { initLayers } from "./layers.js";
import { initMap } from "./map.js";
import { initNews } from "./news.js";
import { initOperator } from "./operator.js";
import { initOps } from "./ops.js";
import { initRegionList } from "./regionlist.js";
import { initSearch } from "./search.js";
import { initStatus } from "./status.js";
import { initTheme } from "./theme.js";
import { initTimeline } from "./timeline.js";
import { initTooltips } from "./tooltips.js";
import { initUi, setLoadingState, showMapError } from "./ui.js";
import { initAutoRefresh, loadThresholds, loadWeather } from "./weather.js";
async function start() {
    initDevLog(); // só em desenvolvimento (window.CLIMASP_DEV_LOG)
    // Partes que funcionam mesmo se o mapa falhar.
    initTheme();
    initTooltips();
    initUi();
    initStatus();
    initAlerts();
    initOperator();
    initNews();
    initRegionList();
    initTimeline();
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
    const { placePin } = initSearch(mapApi);
    initGeolocate(mapApi.map, placePin);
    initLayers(mapApi.map);
    initOps(mapApi);
}
start().catch(err => {
    console.error("Falha ao inicializar o ClimaSP:", err);
    showMapError();
});
