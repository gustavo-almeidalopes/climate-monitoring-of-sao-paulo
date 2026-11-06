-- ClimaSP — operação (equipes, ocorrências) e camadas geográficas em PostgreSQL + PostGIS.
-- Posições em geography(Point, 4326): distâncias em metros direto no banco (ST_DWithin, <->).
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE ops_teams (
    id          serial PRIMARY KEY,
    code        varchar(24)  NOT NULL UNIQUE,
    name        varchar(120) NOT NULL,
    kind        varchar(20)  NOT NULL CHECK (kind IN ('defesa_civil', 'bombeiros', 'cet', 'samu', 'subprefeitura')),
    base_name   varchar(160) NOT NULL,
    base_source varchar(200) NOT NULL,
    base        geography(Point, 4326) NOT NULL,
    position    geography(Point, 4326) NOT NULL,
    status      varchar(20)  NOT NULL DEFAULT 'disponivel'
                CHECK (status IN ('disponivel', 'em_deslocamento', 'em_ocorrencia', 'indisponivel')),
    is_example  boolean      NOT NULL DEFAULT true,
    updated_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX ops_teams_position_gix ON ops_teams USING gist (position);
CREATE INDEX ops_teams_kind_idx ON ops_teams (kind);

CREATE TABLE ops_incidents (
    id          serial PRIMARY KEY,
    kind        varchar(30)  NOT NULL DEFAULT 'alagamento',
    description varchar(500) NOT NULL DEFAULT '',
    address     varchar(200) NOT NULL DEFAULT '',
    location    geography(Point, 4326) NOT NULL,
    region_code varchar(4),
    status      varchar(20)  NOT NULL DEFAULT 'aberta'
                CHECK (status IN ('aberta', 'despachada', 'no_local', 'resolvida')),
    team_id     integer REFERENCES ops_teams (id),
    eta_minutes double precision,
    opened_at   timestamptz  NOT NULL,
    assigned_at timestamptz,
    arrived_at  timestamptz,
    resolved_at timestamptz,
    is_example  boolean      NOT NULL DEFAULT false
);
CREATE INDEX ops_incidents_location_gix ON ops_incidents USING gist (location);
CREATE INDEX ops_incidents_status_idx ON ops_incidents (status);
CREATE INDEX ops_incidents_opened_idx ON ops_incidents (opened_at DESC);

CREATE TABLE ops_incident_events (
    id          serial PRIMARY KEY,
    incident_id integer      NOT NULL REFERENCES ops_incidents (id) ON DELETE CASCADE,
    at          timestamptz  NOT NULL,
    kind        varchar(24)  NOT NULL,
    team_id     integer,
    note        varchar(300) NOT NULL DEFAULT '',
    actor_role  varchar(16)  NOT NULL DEFAULT 'operador'
);
CREATE INDEX ops_incident_events_incident_idx ON ops_incident_events (incident_id, at, id);

-- Grade hexagonal H3 (res. 9) da Zona Norte: data/geo/hex-zona-norte.geojson.
CREATE TABLE geo_cells (
    h3       varchar(16) PRIMARY KEY,
    region   varchar(4)  NOT NULL,
    district text        NOT NULL,
    susc     double precision,
    props    jsonb       NOT NULL,
    geom     geometry(Polygon, 4326) NOT NULL,
    center   geography(Point, 4326)  NOT NULL
);
CREATE INDEX geo_cells_geom_gix ON geo_cells USING gist (geom);
CREATE INDEX geo_cells_center_gix ON geo_cells USING gist (center);

-- Polígonos oficiais do GeoSampa (área inundável, risco hidrológico): data/geo/geosampa/*.geojson.
CREATE TABLE geo_areas (
    id    serial PRIMARY KEY,
    layer varchar(40) NOT NULL,
    name  text,
    props jsonb       NOT NULL,
    geom  geometry(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX geo_areas_geom_gix ON geo_areas USING gist (geom);
CREATE INDEX geo_areas_layer_idx ON geo_areas (layer);
