/*
 * Busca de endereço (Nominatim/OSM) com histórico local e sugestões.
 * O pino mostra o nível de perigo da subprefeitura onde o ponto está.
 * Texto vindo do Nominatim é dado de terceiros: sempre escapado.
 */
import { icon } from "./icons.js";
import { searchPopup } from "./popup.js";
import { effectiveThresholds, store } from "./state.js";
import { hideTooltip } from "./tooltips.js";
import { hideToast, showToast } from "./ui.js";
import { $, debounce, escapeHtml, normalizeName, storage } from "./util.js";

const HISTORY_KEY = "climasp_search_history";
const MAX_HISTORY = 5;
const POPULAR = [
    "Marginal Tietê", "Av. Braz Leme", "Av. Cruzeiro do Sul", "Av. Guilherme Cotching",
    "Casa Verde", "Santana", "Tucuruvi", "Jaçanã", "Vila Maria", "Vila Guilherme",
];

const norm = v => normalizeName(v).toLowerCase();

export const SearchHistory = {
    get() {
        const list = storage.get(HISTORY_KEY, []);
        return Array.isArray(list) ? list.filter(x => typeof x === "string") : [];
    },
    add(query) {
        const q = String(query || "").trim();
        if (!q) return;
        storage.set(HISTORY_KEY, [q, ...this.get().filter(h => norm(h) !== norm(q))].slice(0, MAX_HISTORY));
    },
    remove(query) {
        storage.set(HISTORY_KEY, this.get().filter(h => h !== query));
    },
    suggest(value) {
        const v = norm(value);
        const history = this.get().filter(h => !v || norm(h).includes(v));
        const popular = POPULAR.filter(p => (!v || norm(p).includes(v)) && !history.some(h => norm(h) === norm(p)));
        return [
            ...history.map(text => ({ text, kind: "history" })),
            ...popular.map(text => ({ text, kind: "popular" })),
        ].slice(0, 6);
    },
};

function initSuggestions(onPick) {
    const input = $<HTMLInputElement>("#searchInput");
    const box = $("#searchSuggestions");
    let items: any[] = [];
    let activeIndex = -1;
    // Cada fechamento invalida sugestões ainda pendentes no debounce da digitação,
    // para a lista não reabrir sozinha depois que a busca já começou.
    let epoch = 0;
    let typedAt = 0;

    function close() {
        epoch++;
        box.classList.remove("show");
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
        activeIndex = -1;
    }

    function setActive(i) {
        const nodes = Array.from(box.querySelectorAll(".suggestion-item"));
        nodes.forEach(n => { n.classList.remove("active"); n.setAttribute("aria-selected", "false"); });
        activeIndex = i;
        if (i >= 0 && nodes[i]) {
            nodes[i].classList.add("active");
            nodes[i].setAttribute("aria-selected", "true");
            nodes[i].scrollIntoView({ block: "nearest" });
            input.setAttribute("aria-activedescendant", nodes[i].id);
        } else {
            input.removeAttribute("aria-activedescendant");
        }
    }

    function open(list) {
        items = list;
        if (!items.length) { close(); return; }
        box.innerHTML = items.map((sug, i) => {
            const safe = escapeHtml(sug.text);
            const drop = sug.kind === "history"
                ? `<span class="suggestion-drop" data-remove="${safe}" title="Remover do histórico">${icon("x")}<span class="sr-only">Remover do histórico</span></span>`
                : "";
            return `<div class="suggestion-item" role="option" id="sugg-${i}" aria-selected="false" data-value="${safe}">` +
                `${icon(sug.kind === "history" ? "clock" : "map-pin", "suggestion-kind")}` +
                `<span class="suggestion-text">${safe}</span>${drop}</div>`;
        }).join("");
        box.classList.add("show");
        input.setAttribute("aria-expanded", "true");
        activeIndex = -1;
    }

    const refresh = () => open(SearchHistory.suggest(input.value));
    const pick = value => { input.value = value; close(); onPick(); };

    const refreshTyped = debounce(() => { if (typedAt === epoch) refresh(); }, 180);
    input.addEventListener("input", () => { typedAt = epoch; refreshTyped(); });
    input.addEventListener("focus", refresh);
    input.addEventListener("keydown", e => {
        const isOpen = box.classList.contains("show");
        if (e.key === "ArrowDown" && !isOpen) { e.preventDefault(); refresh(); return; }
        if (e.key === "Enter") {
            e.preventDefault();
            if (isOpen && activeIndex >= 0) pick(items[activeIndex].text);
            else { close(); onPick(); }
            return;
        }
        if (!isOpen) return;
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((activeIndex + 1) % items.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((activeIndex - 1 + items.length) % items.length); }
        else if (e.key === "Escape") close();
    });
    box.addEventListener("mousedown", e => e.preventDefault());
    box.addEventListener("click", e => {
        const remove = (e.target as Element).closest("[data-remove]");
        if (remove) { SearchHistory.remove(remove.getAttribute("data-remove")); refresh(); return; }
        const item = (e.target as Element).closest(".suggestion-item");
        if (item) pick(item.getAttribute("data-value"));
    });
    document.addEventListener("click", e => { if (!(e.target as Element).closest("#mapSearchWrap")) close(); });
    return { close };
}

export function initSearch({ map, locate }) {
    let pin: L.Marker | null = null;
    let current: { title: string; address: string; lat: number; lng: number } | null = null;

    const pinIcon = L.divIcon({ className: "search-pin", html: '<div class="search-pin-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });

    function popupHtml() {
        const state = store.get();
        if (!current) return "";
        const place = locate(current.lat, current.lng);
        const region = place ? state.regions[place.regionId] || null : null;
        return searchPopup({ ...current, place, region, thresholds: effectiveThresholds(state), now: state.now, model: state.model });
    }

    /** Põe (ou move) o pino com o popup de risco do ponto. Usado pela busca e por "minha localização". */
    function placePin(point, { zoom = 15, extra = null } = {}) {
        current = point;
        if (pin) map.removeLayer(pin);
        if (extra) map.removeLayer(extra);
        pin = L.marker([point.lat, point.lng], { icon: pinIcon, title: point.title, alt: point.title })
            .addTo(map)
            .bindPopup(popupHtml(), { maxWidth: 330 })
            .openPopup();
        map.flyTo([point.lat, point.lng], zoom, { duration: 1.2 });
        return pin;
    }

    // O pino acompanha as atualizações de dados, sem nova busca.
    store.subscribe(s => [s.regions, effectiveThresholds(s), s.now], () => {
        if (pin && current) pin.setPopupContent(popupHtml());
    }, { immediate: false });

    async function doSearch() {
        const input = $<HTMLInputElement>("#searchInput");
        const btn = $<HTMLButtonElement>("#searchBtn");
        const q = input.value.trim();
        if (!q) return;
        suggestions.close();
        hideTooltip();
        hideToast();
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        btn.classList.add("busy");
        try {
            const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=" +
                encodeURIComponent(`${q}, São Paulo, Brasil`);
            const resp = await fetch(url, { headers: { "Accept-Language": "pt-BR" } });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            if (!Array.isArray(data) || !data.length) { showToast("Endereço não encontrado em SP."); return; }
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) { showToast("Endereço não encontrado em SP."); return; }
            const address = String(data[0].display_name || q);
            placePin({ title: address.split(",")[0], address, lat, lng });
            SearchHistory.add(q);
        } catch (err) {
            console.warn("Falha na busca:", err);
            showToast("Erro de conexão com o serviço de endereços (Nominatim).");
        } finally {
            btn.classList.remove("busy");
            btn.removeAttribute("aria-busy");
            btn.disabled = false;
        }
    }

    const suggestions = initSuggestions(doSearch);
    $("#searchBtn").addEventListener("click", doSearch);
    return { placePin };
}
