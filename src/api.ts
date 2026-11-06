/* Cliente HTTP do backend ClimaSP. A URL vem de config.js (window.CLIMASP_API_BASE). */
import type { Incident, OpsRole, Team } from "./types.js";

export interface ServerRoute { minutes: number; km: number; coords: [number, number][]; estimated: boolean }
export interface NearestResponse {
    source: string;
    estimated: boolean;
    candidates: { team: Team; minutes: number; routes: ServerRoute[]; estimated: boolean }[];
}

function defaultBase() {
    const { hostname, origin } = window.location;
    const local = hostname === "localhost" || hostname === "127.0.0.1";
    return local ? "http://localhost:8000" : origin;
}

export const API_BASE = String(window.CLIMASP_API_BASE || defaultBase()).replace(/\/$/, "");

export class ApiError extends Error {
    status: number;
    detail: string;

    constructor(status: number, detail: string, path: string) {
        super(`HTTP ${status} em ${path}`);
        this.status = status;
        this.detail = detail;
    }
}

interface RequestOptions {
    method?: string;
    timeout?: number;
    body?: unknown;
    token?: string | null;
}

async function request<T = any>(path: string, { method = "GET", timeout = 12000, body = undefined, token = null }: RequestOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
        const resp = await fetch(API_BASE + path, {
            method, cache: "no-store", signal: controller.signal, headers,
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!resp.ok) {
            let detail = "";
            try { detail = (await resp.json()).detail || ""; } catch (_) { /* sem corpo */ }
            throw new ApiError(resp.status, detail, path);
        }
        return (resp.status === 204 ? null : await resp.json()) as T;
    } finally {
        clearTimeout(timer);
    }
}

export const api = {
    thresholds: () => request("/api/v1/weather/thresholds"),
    current: () => request("/api/v1/weather/current"),
    overview: () => request("/api/v1/weather/overview"),
    news: () => request("/api/v1/news/?limit=40&hours=72&min_relevance=1"),
    scrapeNews: () => request("/api/v1/news/scrape", { method: "POST", timeout: 60000 }),
};

/** Rotas de operação (Fase 3) — exigem a credencial do perfil. */
export const opsApi = {
    me: (token: string) => request<{ role: OpsRole }>("/api/v1/ops/me", { token }),
    teams: (token: string) => request<Team[]>("/api/v1/ops/teams", { token }),
    patchTeam: (token: string, id: number, body: Partial<Pick<Team, "status" | "lat" | "lng">>) =>
        request<Team>(`/api/v1/ops/teams/${id}`, { method: "PATCH", token, body }),
    incidents: (token: string) => request<Incident[]>("/api/v1/ops/incidents?limit=100", { token }),
    openIncident: (token: string, body: { lat: number; lng: number; kind?: string; description?: string; address?: string }) =>
        request<Incident>("/api/v1/ops/incidents", { method: "POST", token, body }),
    assign: (token: string, id: number, body: { team_id: number; eta_minutes?: number | null }) =>
        request<Incident>(`/api/v1/ops/incidents/${id}/assign`, { method: "POST", token, body }),
    arrive: (token: string, id: number) => request<Incident>(`/api/v1/ops/incidents/${id}/arrive`, { method: "POST", token }),
    resolve: (token: string, id: number, note = "") =>
        request<Incident>(`/api/v1/ops/incidents/${id}/resolve`, { method: "POST", token, body: { note } }),
    report: (token: string, hours = 24) => request(`/api/v1/ops/report?hours=${hours}`, { token }),
    /** Serviço Java (services/ops-java): equipes mais rápidas calculadas no servidor (GraphHopper/OSRM). */
    nearest: (token: string, lat: number, lng: number, limit = 5) =>
        request<NearestResponse>(`/api/v1/ops/nearest?lat=${lat}&lng=${lng}&limit=${limit}`, { token, timeout: 20000 }),
};

/** Desenvolvimento: envia um erro do navegador ao servidor (DEV_CLIENT_LOG=true). */
export function sendClientLog(entry: Record<string, unknown>): void {
    try {
        const body = JSON.stringify(entry);
        if (navigator.sendBeacon) navigator.sendBeacon(API_BASE + "/api/v1/dev/client-log", new Blob([body], { type: "application/json" }));
        else fetch(API_BASE + "/api/v1/dev/client-log", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true });
    } catch (_) { /* nunca quebra a página */ }
}
