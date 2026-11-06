/* Utilitários sem dependências, compartilhados pelos módulos. */

/**
 * Primeiro elemento que casa com o seletor. Os ids usados existem em index.html (os testes
 * e2e garantem), então o retorno é tipado sem `null`; informe o tipo quando precisar
 * de propriedades específicas: $<HTMLInputElement>("#searchInput").value.
 */
export function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
    return root.querySelector(selector) as T;
}
export function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
    return Array.from(root.querySelectorAll<T>(selector));
}

export function escapeHtml(value: unknown): string {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[c] as string);
}

/**
 * Remove emojis e pictogramas de texto vindo de fora (títulos e resumos de RSS),
 * para a interface seguir só com texto e ícones do sprite. Acentos e pontuação ficam.
 */
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}\u{2022}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;
export function stripEmoji(value: unknown): string {
    return String(value == null ? "" : value).replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    return function debounced(this: unknown, ...args: A) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
}

/** Executa `op` e devolve `fallback` se o navegador bloquear o acesso (modo privado etc.). */
export function safely<T>(op: () => T, fallback: T): T {
    try { return op(); } catch (_) { return fallback; }
}

/** JSON em localStorage/sessionStorage, tolerante a falhas. */
export const storage = {
    get<T = any>(key: string, fallback: T | null = null, area: "local" | "session" = "local"): T | null {
        return safely(() => {
            const raw = window[`${area}Storage`].getItem(key);
            return raw == null ? fallback : JSON.parse(raw);
        }, fallback);
    },
    set(key: string, value: unknown, area: "local" | "session" = "local"): void {
        safely(() => window[`${area}Storage`].setItem(key, JSON.stringify(value)), null);
    },
    remove(key: string, area: "local" | "session" = "local"): void {
        safely(() => window[`${area}Storage`].removeItem(key), null);
    },
};

export function prefersReducedMotion(): boolean {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

/** Número finito ou `null` (para exibir "—" em vez de inventar um valor). */
export function num(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

/** Caixa alta, sem acentos — para comparar nomes de distritos. */
export function normalizeName(value: unknown): string {
    return String(value || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function fmt1(value: number | null | undefined): string { return value == null ? "—" : nf1.format(value); }
export function fmt0(value: number | null | undefined): string { return value == null ? "—" : nf0.format(value); }

export function fmtClock(ms: number | string | null | undefined): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(ms: number | string | null | undefined): string {
    if (!ms) return "—";
    return new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function timeAgo(value: number | string | null | undefined, now: number = Date.now()): string {
    if (!value) return "";
    const ms = typeof value === "number" ? value : Date.parse(value);
    if (!Number.isFinite(ms)) return "";
    const diff = (now - ms) / 60000;
    if (diff < 1) return "agora mesmo";
    if (diff < 60) return `há ${Math.round(diff)} min`;
    if (diff < 1440) return `há ${Math.round(diff / 60)} h`;
    return `há ${Math.round(diff / 1440)} d`;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
}

type Ring = number[][];

function inRing(lng: number, lat: number, ring: Ring): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
    if (!rings.length || !inRing(lng, lat, rings[0])) return false;
    for (let k = 1; k < rings.length; k++) if (inRing(lng, lat, rings[k])) return false; // furos
    return true;
}

/** Ponto dentro de uma geometria GeoJSON Polygon/MultiPolygon (coordenadas [lng, lat]). */
export function pointInGeometry(lat: number, lng: number, geometry: GeoJSON.Geometry | null | undefined): boolean {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return inPolygon(lng, lat, geometry.coordinates);
    if (geometry.type === "MultiPolygon") return geometry.coordinates.some(rings => inPolygon(lng, lat, rings));
    return false;
}
