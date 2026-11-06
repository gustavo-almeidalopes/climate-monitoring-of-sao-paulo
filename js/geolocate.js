/*
 * Botão "minha localização" (Geolocation API): mostra o nível de perigo da subprefeitura
 * em que a pessoa está, ou a região monitorada mais próxima. A posição não sai do navegador.
 */
import { icon } from "./icons.js";
import { showToast } from "./ui.js";
const ERRORS = {
    1: "Permissão de localização negada. Ative-a nas configurações do navegador para usar este botão.",
    2: "Não foi possível obter sua localização agora.",
    3: "A localização demorou demais para responder. Tente de novo.",
};
export function initGeolocate(map, placePin) {
    let accuracyCircle = null;
    const Control = L.Control.extend({
        options: { position: "topleft" },
        onAdd() {
            const wrap = L.DomUtil.create("div", "leaflet-bar locate-control");
            const btn = L.DomUtil.create("button", "locate-btn", wrap);
            btn.type = "button";
            btn.id = "btnLocate";
            btn.title = "Minha localização";
            btn.setAttribute("aria-label", "Mostrar o risco na minha localização");
            btn.innerHTML = icon("crosshair");
            L.DomEvent.disableClickPropagation(wrap);
            L.DomEvent.on(btn, "click", () => locate(btn));
            return wrap;
        },
    });
    new Control().addTo(map);
    function locate(btn) {
        if (!("geolocation" in navigator)) {
            showToast("Este navegador não oferece localização.");
            return;
        }
        btn.classList.add("busy");
        btn.setAttribute("aria-busy", "true");
        navigator.geolocation.getCurrentPosition(pos => {
            btn.classList.remove("busy");
            btn.removeAttribute("aria-busy");
            const { latitude: lat, longitude: lng, accuracy } = pos.coords;
            if (accuracyCircle)
                map.removeLayer(accuracyCircle);
            accuracyCircle = L.circle([lat, lng], { radius: accuracy, className: "accuracy-circle", interactive: false }).addTo(map);
            placePin({ title: "Sua localização", address: `Precisão de ±${Math.round(accuracy)} m`, lat, lng }, { zoom: 15 });
        }, err => {
            btn.classList.remove("busy");
            btn.removeAttribute("aria-busy");
            showToast(ERRORS[err.code] || ERRORS[2]);
        }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
    }
}
