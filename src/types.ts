/*
 * Tipos de domínio do front-end. Espelham as respostas do backend
 * (app/views/weather_views.py, app/controllers/ops_controller.py) depois de normalizadas
 * por weather.ts — números ausentes viram `null`, nunca um valor inventado.
 */

export type RegionId = "CV" | "ST" | "JT" | "MG";
export type LevelKey = "low" | "medium" | "high" | "critical";
export type RiskSource = "ml" | "heuristic" | "sample" | "unknown" | (string & {});

export interface Level {
    level: LevelKey;
    rank: number;
    label: string;
    color: string;
}

export interface Danger extends Level {
    reason: string;
}

export interface RiskCuts {
    medium: number;
    high: number;
    critical: number;
}

export interface Thresholds {
    red: number;
    orange: number;
    yellow: number;
    riskCuts: RiskCuts;
}

export interface Trend {
    direction: "up" | "down" | "flat" | (string & {});
    since: number | null;
    delta: number;
}

export interface SeriesPoint {
    t: number;
    kind: "observed" | "forecast";
    rain: number | null;
    risk: number | null;
    riskSource: RiskSource;
}

export interface RecentPoint {
    t: number;
    rain: number | null;
    risk: number | null;
}

export interface Nowcast {
    asOf: number | null;
    horizonHours: number | null;
    heavyRainMm: number | null;
    probability: number | null;
    alert: boolean;
    expectedMm: number | null;
}

export interface RegionMeta {
    id: RegionId;
    name: string;
    short: string;
    lat: number;
    lng: number;
}

export interface Region extends RegionMeta {
    temp: number | null;
    hum: number | null;
    rain: number | null;
    wind: number | null;
    risk: number | null;
    riskSource: RiskSource;
    recordedAt: number | null;
    series: SeriesPoint[];
    recent: RecentPoint[];
    trend: { rain: Trend | null; risk: Trend | null } | null;
    nowcast: Nowcast | null;
    prevRisk?: number | null;
    prevRain?: number | null;
    isSample: boolean;
    /** Presentes quando a região foi deslocada na linha do tempo (regionAtOffset). */
    kind?: "observed" | "forecast";
    atTime?: number | null;
}

/** Região vista numa hora da linha do tempo (regionAtOffset). */
export interface RegionAt extends Region {
    kind: "observed" | "forecast";
    atTime: number | null;
}

/** Algo com chuva e índice — região ou ponto da série. */
export interface RainRiskPoint {
    rain?: number | null;
    risk?: number | null;
    riskSource?: RiskSource;
    risk_source?: RiskSource;
}

export type Regions = Partial<Record<RegionId, Region>>;

export interface ModelSummary {
    available: boolean;
    precision?: number | null;
    recall?: number | null;
    [key: string]: unknown;
}

export interface AlertEntry {
    t: number;
    id: RegionId;
    short: string;
    from: LevelKey | null;
    to: LevelKey;
    rain: number | null;
    risk: number | null;
}

/* ------------------------------------------------------------------ operação */

export type OpsRole = "operador" | "gestor";
export type TeamKind = "defesa_civil" | "bombeiros" | "cet" | "samu" | "subprefeitura";
export type TeamStatus = "disponivel" | "em_deslocamento" | "em_ocorrencia" | "indisponivel";
export type IncidentStatus = "aberta" | "despachada" | "no_local" | "resolvida";

export interface Team {
    id: number;
    code: string;
    name: string;
    kind: TeamKind;
    status: TeamStatus;
    lat: number;
    lng: number;
    base_name: string;
    base_source: string;
    base_lat: number;
    base_lng: number;
    is_example: boolean;
    updated_at: string | null;
}

export interface TimelineEvent {
    at: string;
    kind: string;
    team_id: number | null;
    note: string;
    actor_role: string;
}

export interface Incident {
    id: number;
    kind: string;
    description: string;
    address: string;
    lat: number;
    lng: number;
    region: RegionId | null;
    status: IncidentStatus;
    team_id: number | null;
    eta_minutes: number | null;
    opened_at: string;
    assigned_at: string | null;
    arrived_at: string | null;
    resolved_at: string | null;
    is_example: boolean;
    timeline: TimelineEvent[];
}

export interface Place {
    inside: boolean;
    district?: string;
    region?: RegionId | null;
    [key: string]: unknown;
}

export interface OpsTarget {
    lat: number;
    lng: number;
    place?: Place | null;
}

/** Estados de carregamento assíncrono usados no painel de operação. */
export type Loadable<T> = T | { loading: true } | { error: string };

/* --------------------------------------------------------------------- estado */

export interface AppState {
    theme: "light" | "dark";
    connection: "loading" | "online" | "offline";
    source: "none" | "live" | "sample";
    regions: Regions;
    updatedAt: number | null;
    hasSeries: boolean;
    model: ModelSummary;
    changes: Partial<Record<RegionId, { rain?: boolean; risk?: boolean; level?: boolean }>>;
    changesAt: number;
    selectedRegion: RegionId | null;
    timeOffset: number;
    officialThresholds: Thresholds;
    customThresholds: Thresholds | null;
    operator: boolean;
    baseLayer: "auto" | "satellite" | "osm";
    alertDismissed: { level: LevelKey; ids: RegionId[] } | null;
    alertHistory: AlertEntry[];
    alertSeenAt: number;
    sideTab: "regions" | "ops";
    opsRole: OpsRole | null;
    opsTeams: Team[];
    opsIncidents: Incident[];
    opsReport: any;
    opsError: string | null;
    opsTarget: OpsTarget | null;
    opsCandidates: any;
    now: number;
}
