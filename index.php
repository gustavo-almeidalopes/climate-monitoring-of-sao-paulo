<?php
// ─────────────────────────────────────────────────────────────────
// Monitoramento Climático — Lote 3 — Limpebras
// Dashboard interativo: clima + alagamentos via Open-Meteo API
// Inspirado no CGE-SP (cgesp.prefeitura.sp.gov.br)
// ─────────────────────────────────────────────────────────────────
$titulo   = "Monitoramento Climático — Lote 3";
$projeto  = "Monitoramento Climático Lote 3 — Limpebras";
$ano      = date("Y");

// ── Subprefeituras ──────────────────────────────────────────────
$subprefeituras = [
  ["id" => "cv", "slug" => "casa-verde",               "nome" => "Casa Verde",              "cor" => "#34C759", "lat" => -23.4988, "lng" => -46.6658],
  ["id" => "st", "slug" => "santana-tucuruvi",          "nome" => "Santana/Tucuruvi",        "cor" => "#007AFF", "lat" => -23.4810, "lng" => -46.6270],
  ["id" => "jt", "slug" => "jacana-tremembe",           "nome" => "Jaçanã/Tremembé",         "cor" => "#FF9500", "lat" => -23.4500, "lng" => -46.5830],
  ["id" => "mg", "slug" => "vila-maria-vila-guilherme",  "nome" => "Vila Maria/Vila Guilherme","cor" => "#AF52DE", "lat" => -23.5100, "lng" => -46.5850],
];

// ── Pontos de alagamento conhecidos (infraestrutura/geográficos) ─
// O RISCO é calculado dinamicamente via API, NÃO está hardcoded.
// Esses são os locais fisicamente vulneráveis a enchentes.
// Fontes: CGE, Defesa Civil, SAISP, registros históricos.
// ──────────────────────────────────────────────────────────────────
$pontos = [
  // Casa Verde — córregos do Mandaqui e Carajás, marginal Tietê
  ["lat" => -23.5080, "lng" => -46.6690, "rua" => "Av. Eng. Caetano Álvares (Ponte Casa Verde)",        "sub" => "cv", "tipo" => "marginal",    "cota" => 724],
  ["lat" => -23.4970, "lng" => -46.6700, "rua" => "R. Peri / Marginal Tietê",                           "sub" => "cv", "tipo" => "marginal",    "cota" => 722],
  ["lat" => -23.5020, "lng" => -46.6630, "rua" => "Av. Eng. Caetano Álvares (alt. Limão)",              "sub" => "cv", "tipo" => "via_arterial","cota" => 726],
  ["lat" => -23.5045, "lng" => -46.6750, "rua" => "R. Cel. Mario de Azevedo",                           "sub" => "cv", "tipo" => "baixada",     "cota" => 728],
  ["lat" => -23.4930, "lng" => -46.6680, "rua" => "R. José Bernardo Pinto (trecho baixo)",              "sub" => "cv", "tipo" => "baixada",     "cota" => 730],

  // Santana/Tucuruvi — córregos do Tremembé e Lauzane
  ["lat" => -23.4870, "lng" => -46.6285, "rua" => "R. Voluntários da Pátria (baixada Metrô Santana)",   "sub" => "st", "tipo" => "via_arterial","cota" => 735],
  ["lat" => -23.4780, "lng" => -46.6190, "rua" => "Av. Tucuruvi (próx. Córrego Tremembé)",              "sub" => "st", "tipo" => "corrego",     "cota" => 740],
  ["lat" => -23.4920, "lng" => -46.6330, "rua" => "R. Alfredo Pujol (trecho central)",                  "sub" => "st", "tipo" => "baixada",     "cota" => 738],
  ["lat" => -23.4830, "lng" => -46.6240, "rua" => "R. Conselheiro Moreira de Barros",                   "sub" => "st", "tipo" => "baixada",     "cota" => 736],
  ["lat" => -23.4755, "lng" => -46.6080, "rua" => "Av. Mazzei (Tucuruvi)",                              "sub" => "st", "tipo" => "via_arterial","cota" => 742],

  // Jaçanã/Tremembé — córregos do Bispo e Cabuçu
  ["lat" => -23.4580, "lng" => -46.5730, "rua" => "Av. Guapira (trecho alagável)",                      "sub" => "jt", "tipo" => "via_arterial","cota" => 760],
  ["lat" => -23.4510, "lng" => -46.5800, "rua" => "Av. Cel. Sezefredo Fagundes (baixada)",              "sub" => "jt", "tipo" => "via_arterial","cota" => 755],
  ["lat" => -23.4620, "lng" => -46.5680, "rua" => "R. Filhos da Terra (Jaçanã)",                        "sub" => "jt", "tipo" => "corrego",     "cota" => 758],
  ["lat" => -23.4440, "lng" => -46.5850, "rua" => "Estrada do Corredor (Tremembé)",                     "sub" => "jt", "tipo" => "baixada",     "cota" => 770],
  ["lat" => -23.4555, "lng" => -46.5760, "rua" => "R. Mário Lago / Córrego do Bispo",                   "sub" => "jt", "tipo" => "corrego",     "cota" => 752],

  // Vila Maria/Vila Guilherme — marginal Tietê, córrego Cabuçu de Baixo
  ["lat" => -23.5130, "lng" => -46.5850, "rua" => "Marginal Tietê (Ponte do Piqueri)",                  "sub" => "mg", "tipo" => "marginal",    "cota" => 720],
  ["lat" => -23.5070, "lng" => -46.5780, "rua" => "R. Serra de Botucatu (Vila Maria)",                  "sub" => "mg", "tipo" => "baixada",     "cota" => 728],
  ["lat" => -23.5150, "lng" => -46.5920, "rua" => "Av. Guilherme Cotching (baixada)",                   "sub" => "mg", "tipo" => "via_arterial","cota" => 726],
  ["lat" => -23.5060, "lng" => -46.5900, "rua" => "R. Comandante Taylor (Vila Guilherme)",              "sub" => "mg", "tipo" => "baixada",     "cota" => 730],
  ["lat" => -23.5110, "lng" => -46.5750, "rua" => "Av. Edu Chaves (próx. Tietê)",                       "sub" => "mg", "tipo" => "marginal",    "cota" => 722],
];

// ── Filtros GET ─────────────────────────────────────────────────
$busca = isset($_GET['q']) ? htmlspecialchars(trim($_GET['q']), ENT_QUOTES, 'UTF-8') : '';
$tipo_mapa = isset($_GET['mapa']) ? htmlspecialchars($_GET['mapa'], ENT_QUOTES, 'UTF-8') : 'openstreetmap';
if (!in_array($tipo_mapa, ['openstreetmap', 'satelite', 'topo'])) $tipo_mapa = 'openstreetmap';

$filtro_sub = [];
if (isset($_GET['sub']) && is_array($_GET['sub'])) {
  $ids_validos = array_column($subprefeituras, 'id');
  foreach ($_GET['sub'] as $s) {
    $s = htmlspecialchars($s, ENT_QUOTES, 'UTF-8');
    if (in_array($s, $ids_validos)) $filtro_sub[] = $s;
  }
}
if (empty($filtro_sub)) $filtro_sub = array_column($subprefeituras, 'id');

// JSON para JS
$j_sub    = json_encode($subprefeituras, JSON_UNESCAPED_UNICODE);
$j_pontos = json_encode($pontos, JSON_UNESCAPED_UNICODE);
$j_filtro = json_encode($filtro_sub);
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title><?= htmlspecialchars($titulo) ?></title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Montserrat',system-ui,sans-serif;background:#F2F2F7;color:#1C1C1E;font-size:14px}

    /* ── Topbar ── */
    .topbar{background:#1C1C1E;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
    .topbar h1{font-size:1rem;font-weight:700;letter-spacing:-.3px}
    .topbar .badge{font-size:.7rem;background:#FF9500;color:#000;padding:2px 8px;border-radius:10px;font-weight:700}
    .topbar .clock{font-size:.75rem;color:#aaa;font-weight:600}

    /* ── Layout grid ── */
    .dashboard{display:grid;grid-template-columns:300px 1fr;grid-template-rows:1fr;height:calc(100vh - 44px);overflow:hidden}

    /* ── Sidebar ── */
    .sidebar{background:#fff;border-right:1px solid #d1d1d6;overflow-y:auto;display:flex;flex-direction:column}
    .sidebar section{padding:12px 16px;border-bottom:1px solid #e5e5ea}
    .sidebar h2{font-size:.7rem;text-transform:uppercase;letter-spacing:.8px;color:#8e8e93;font-weight:700;margin-bottom:8px}

    /* ── Weather cards (CGE-style) ── */
    .weather-card{background:#f9f9fb;border-radius:8px;padding:10px 12px;margin-bottom:8px}
    .weather-card .temp-row{display:flex;justify-content:space-between;align-items:baseline}
    .weather-card .temp-big{font-size:2rem;font-weight:800;line-height:1}
    .weather-card .temp-label{font-size:.7rem;color:#8e8e93;text-transform:uppercase}
    .weather-card .detail{font-size:.78rem;color:#555;margin-top:3px}
    .weather-card .period-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
    .weather-card .period{background:#fff;border-radius:6px;padding:6px 8px;font-size:.75rem;border:1px solid #e5e5ea}
    .weather-card .period strong{display:block;font-size:.68rem;color:#8e8e93;text-transform:uppercase;margin-bottom:2px}

    /* ── Flood status (CGE-style) ── */
    .flood-status{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}
    .flood-box{text-align:center;border-radius:8px;padding:10px 6px}
    .flood-box .num{font-size:1.8rem;font-weight:800;line-height:1}
    .flood-box .lbl{font-size:.65rem;text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-top:2px}
    .flood-box.intransitavel{background:#FF3B3015;color:#FF3B30}
    .flood-box.transitavel{background:#FF950015;color:#FF9500}
    .flood-box.atencao{background:#FFCC0015;color:#b38f00}
    .flood-box.normal{background:#34C75915;color:#34C759}

    .flood-total{text-align:center;background:#1C1C1E;color:#fff;border-radius:8px;padding:8px;font-weight:700;font-size:.85rem;margin-bottom:6px}
    .flood-total span{color:#FF3B30}

    /* ── Point list ── */
    .point-list{max-height:260px;overflow-y:auto}
    .point-item{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:.78rem;cursor:pointer;transition:background .15s}
    .point-item:hover{background:#f2f2f7}
    .point-item .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;margin-top:3px}
    .point-item .street{font-weight:600}
    .point-item .meta{color:#8e8e93;font-size:.7rem}

    /* ── Search ── */
    .search-row{display:flex;gap:6px}
    .search-row input{flex:1;padding:7px 10px;border:1px solid #d1d1d6;border-radius:6px;font-size:.82rem;font-family:inherit}
    .search-row button{padding:7px 12px;background:#007AFF;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;font-family:inherit;font-size:.82rem}

    /* ── Checkboxes ── */
    .chk-group label{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.82rem;cursor:pointer}
    .chk-group .dot{width:10px;height:10px;border-radius:50%;display:inline-block}

    /* ── Map container ── */
    .map-wrap{position:relative}
    #mapa{width:100%;height:100%}

    /* ── Floating panels on map ── */
    .panel{position:absolute;z-index:800;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);border-radius:10px;padding:12px 16px;box-shadow:0 2px 12px rgba(0,0,0,.12);font-size:.8rem}
    .panel h3{font-size:.82rem;font-weight:700;margin-bottom:4px}

    .panel-weather{top:10px;right:10px;min-width:210px}
    .panel-legend{bottom:24px;left:10px}
    .panel-legend .row{display:flex;align-items:center;gap:6px;margin-bottom:3px}
    .panel-legend .icon{width:14px;height:14px;border-radius:50%;border:2px solid}

    .panel-alert{top:10px;left:50%;transform:translateX(-50%);text-align:center;font-weight:700;padding:8px 24px;border-radius:8px;display:none}
    .panel-alert.show{display:block;animation:fadeSlide .4s ease}
    .panel-alert.critical{background:#FF3B30;color:#fff}
    .panel-alert.warning{background:#FF9500;color:#fff}
    .panel-alert.watch{background:#FFCC00;color:#1C1C1E}

    @keyframes fadeSlide{from{opacity:0;transform:translateX(-50%) translateY(-10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

    /* ── Footer ── */
    footer{position:fixed;bottom:0;left:0;right:0;background:#1C1C1E;color:#666;text-align:center;padding:4px;font-size:.65rem;z-index:900}

    /* ── Responsive ── */
    @media(max-width:768px){
      .dashboard{grid-template-columns:1fr;grid-template-rows:auto 60vh}
      .sidebar{max-height:45vh;border-right:none;border-bottom:1px solid #d1d1d6}
    }

    .sidebar::-webkit-scrollbar,.point-list::-webkit-scrollbar{width:4px}
    .sidebar::-webkit-scrollbar-thumb,.point-list::-webkit-scrollbar-thumb{background:#ccc;border-radius:2px}
  </style>
</head>
<body>

<!-- ══ TOPBAR ══ -->
<div class="topbar">
  <div style="display:flex;align-items:center;gap:10px">
    <h1><?= htmlspecialchars($projeto) ?></h1>
    <span class="badge">PROTÓTIPO</span>
  </div>
  <div class="clock" id="relogio"></div>
</div>

<!-- ══ DASHBOARD ══ -->
<form method="GET" id="form-filtros">
<div class="dashboard">

  <!-- ── SIDEBAR ── -->
  <div class="sidebar">

    <section>
      <h2>Buscar endereço</h2>
      <div class="search-row">
        <input type="search" name="q" placeholder="Ex: Av. Eng. Caetano Álvares…" value="<?= $busca ?>">
        <button type="button" onclick="buscarEndereco(this.form.q.value)">Ir</button>
      </div>
    </section>

    <section>
      <h2>Previsão do Tempo — Zona Norte</h2>
      <div class="weather-card" id="card-clima">
        <div style="text-align:center;padding:20px;color:#8e8e93">Carregando dados meteorológicos…</div>
      </div>
    </section>

    <section>
      <h2>Pontos de Alagamento</h2>
      <div class="flood-total" id="flood-total">Calculando risco com dados de precipitação…</div>
      <div class="flood-status" id="flood-status"></div>
      <div class="point-list" id="point-list"></div>
    </section>

    <section>
      <h2>Subprefeituras</h2>
      <div class="chk-group">
        <?php foreach ($subprefeituras as $sp): ?>
        <label>
          <input type="checkbox" name="sub[]" value="<?= $sp['id'] ?>"
            <?= in_array($sp['id'], $filtro_sub) ? 'checked' : '' ?>
            onchange="atualizarTudo()">
          <span class="dot" style="background:<?= $sp['cor'] ?>"></span>
          <?= htmlspecialchars($sp['nome']) ?>
        </label>
        <?php endforeach; ?>
      </div>
    </section>

    <section>
      <h2>Tipo de mapa</h2>
      <div class="chk-group">
        <label><input type="radio" name="mapa" value="openstreetmap" <?= $tipo_mapa==='openstreetmap'?'checked':'' ?> onchange="trocarMapa(this.value)"> OpenStreetMap</label>
        <label><input type="radio" name="mapa" value="satelite" <?= $tipo_mapa==='satelite'?'checked':'' ?> onchange="trocarMapa(this.value)"> Satélite (ESRI)</label>
        <label><input type="radio" name="mapa" value="topo" <?= $tipo_mapa==='topo'?'checked':'' ?> onchange="trocarMapa(this.value)"> Topográfico</label>
      </div>
    </section>

  </div>

  <!-- ── MAPA ── -->
  <div class="map-wrap">
    <div id="mapa"></div>

    <div class="panel panel-alert" id="panel-alert"></div>

    <div class="panel panel-weather" id="panel-weather">
      <h3>Clima Agora — Zona Norte</h3>
      <div id="weather-mini">Carregando…</div>
    </div>

    <div class="panel panel-legend">
      <h3>Risco de Alagamento (via API)</h3>
      <div class="row"><span class="icon" style="background:#FF3B3040;border-color:#FF3B30"></span> Intransitável (≥30mm/3h)</div>
      <div class="row"><span class="icon" style="background:#FF950040;border-color:#FF9500"></span> Transitável (≥15mm/3h)</div>
      <div class="row"><span class="icon" style="background:#FFCC0040;border-color:#FFCC00"></span> Atenção (≥5mm/3h)</div>
      <div class="row"><span class="icon" style="background:#34C75940;border-color:#34C759"></span> Normal (&lt;5mm/3h)</div>
    </div>
  </div>

</div>
</form>

<footer>&copy; <?= $ano ?> Limpebras — Monitoramento Climático | Dados: Open-Meteo API (aberta) | Ref: CGE-SP</footer>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

<script>
// ═══════════════════════════════════════════════════════════════
// DADOS PHP → JS
// ═══════════════════════════════════════════════════════════════
const SUBS   = <?= $j_sub ?>;
const PONTOS = <?= $j_pontos ?>;
let   FILTRO = <?= $j_filtro ?>;
const BUSCA  = <?= json_encode($busca) ?>;
const MAPA_TIPO = <?= json_encode($tipo_mapa) ?>;

// ═══════════════════════════════════════════════════════════════
// POLÍGONOS SIMPLIFICADOS (protótipo)
// ═══════════════════════════════════════════════════════════════
const POLIGONOS = {
  cv: [[-23.485,-46.690],[-23.485,-46.655],[-23.500,-46.650],[-23.520,-46.650],[-23.520,-46.690]],
  st: [[-23.460,-46.655],[-23.460,-46.605],[-23.485,-46.600],[-23.500,-46.605],[-23.500,-46.650],[-23.485,-46.655]],
  jt: [[-23.420,-46.610],[-23.420,-46.555],[-23.440,-46.550],[-23.470,-46.555],[-23.470,-46.605],[-23.460,-46.610]],
  mg: [[-23.490,-46.605],[-23.490,-46.560],[-23.505,-46.555],[-23.525,-46.560],[-23.525,-46.600],[-23.505,-46.605]]
};

// ═══════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO DE RISCO — BASEADA EM LIMIARES DO CGE
//
// O CGE usa acumulado em 1h e 3h + intensidade para classificar.
// Adaptamos para os dados horários do Open-Meteo.
//
// Fatores considerados para CADA ponto:
//   1. Precipitação acumulada 3h passadas (dado real)
//   2. Precipitação prevista 3h futuras (previsão)
//   3. Prob. de precipitação nas próx. 3h
//   4. Tipo do ponto: marginal (1.6x) > córrego (1.3x) >
//                     via_arterial (1.1x) > baixada (1.0x)
//   5. Cota altimétrica: quanto menor, mais vulnerável
//
// Classificações (inspiradas no CGE):
//   Intransitável: ≥ 30mm acum. ajust. OU ≥ 20mm + marginal
//   Transitável:   ≥ 15mm acum. ajust. OU ≥ 10mm + marginal/córrego
//   Atenção:       ≥ 5mm acum. ajust.  OU prob ≥ 70% + tipo vuln.
//   Normal:        abaixo dos limiares
// ═══════════════════════════════════════════════════════════════

const TIPO_PESO = { marginal: 1.6, corrego: 1.3, via_arterial: 1.1, baixada: 1.0 };

function calcularRisco(ponto, dadosClima) {
  if (!dadosClima) return { nivel: 'normal', label: 'Sem dados', cor: '#aaa', precip3h: 0, prob: 0, chuvaAgora: 0 };

  const peso = TIPO_PESO[ponto.tipo] || 1.0;
  const cotaFator = 1 + (780 - (ponto.cota || 740)) / 200;
  const precip3h  = (dadosClima.precip3hPassada + dadosClima.precip3hFutura) * peso * cotaFator;
  const probMax   = dadosClima.probMax3h;
  const chuvaAgora = dadosClima.precipAgora;

  let nivel, label, cor;
  if (precip3h >= 30 || (precip3h >= 20 && ponto.tipo === 'marginal') || chuvaAgora >= 15) {
    nivel = 'intransitavel'; label = 'INTRANSITÁVEL'; cor = '#FF3B30';
  } else if (precip3h >= 15 || (precip3h >= 10 && ['marginal','corrego'].includes(ponto.tipo))) {
    nivel = 'transitavel'; label = 'TRANSITÁVEL'; cor = '#FF9500';
  } else if (precip3h >= 5 || (probMax >= 70 && ['marginal','corrego'].includes(ponto.tipo)) || chuvaAgora >= 2) {
    nivel = 'atencao'; label = 'ATENÇÃO'; cor = '#FFCC00';
  } else {
    nivel = 'normal'; label = 'Normal'; cor = '#34C759';
  }

  return { nivel, label, cor, precip3h: precip3h.toFixed(1), prob: probMax, chuvaAgora: chuvaAgora.toFixed(1) };
}

// ═══════════════════════════════════════════════════════════════
// OPEN-METEO API — precipitação por subprefeitura
// ═══════════════════════════════════════════════════════════════
let dadosClimaPorSub = {};

async function fetchClimaOpenMeteo() {
  const lats = SUBS.map(s => s.lat).join(',');
  const lngs = SUBS.map(s => s.lng).join(',');

  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lats}&longitude=${lngs}`
    + '&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,apparent_temperature'
    + '&hourly=precipitation,precipitation_probability,weather_code,temperature_2m'
    + '&timezone=America/Sao_Paulo'
    + '&forecast_days=2&past_days=1';

  try {
    const res = await fetch(url);
    const data = await res.json();
    const resultados = Array.isArray(data) ? data : [data];

    const agora = new Date();
    const horaAtual = agora.getHours();
    const idxAgora = 24 + horaAtual; // past_days=1 → 24h offset

    resultados.forEach((r, i) => {
      const sub = SUBS[i];
      if (!sub || !r.hourly) return;

      const hP = r.hourly.precipitation || [];
      const hProb = r.hourly.precipitation_probability || [];
      const hWx = r.hourly.weather_code || [];
      const hTemp = r.hourly.temperature_2m || [];

      const precip3hPassada = hP.slice(Math.max(0, idxAgora - 3), idxAgora).reduce((a, b) => a + (b || 0), 0);
      const precip3hFutura  = hP.slice(idxAgora, idxAgora + 3).reduce((a, b) => a + (b || 0), 0);
      const probMax3h = Math.max(0, ...hProb.slice(idxAgora, idxAgora + 3).map(v => v || 0));
      const precipAgora = hP[idxAgora] || 0;

      // Períodos do dia (estilo CGE: Madrugada, Manhã, Tarde, Noite)
      const base = 24;
      const ranges = {
        madrugada: [base, base + 5],
        manha:     [base + 6, base + 11],
        tarde:     [base + 12, base + 17],
        noite:     [base + 18, base + 23]
      };

      const periodos = {};
      for (const [nome, [ini, fim]] of Object.entries(ranges)) {
        const precipP = hP.slice(ini, fim + 1).reduce((a, b) => a + (b || 0), 0);
        const probP   = Math.max(0, ...hProb.slice(ini, fim + 1).map(v => v || 0));
        const wxMax   = Math.max(0, ...hWx.slice(ini, fim + 1).map(v => v || 0));
        const temps   = hTemp.slice(ini, fim + 1).filter(t => t != null);
        const tMax    = temps.length ? Math.max(...temps) : null;
        const tMin    = temps.length ? Math.min(...temps) : null;

        // PT — Potencial de Tempestade (nomenclatura CGE)
        let pt = 'Baixo';
        if (precipP >= 25 || probP >= 80 || wxMax >= 95) pt = 'Alto';
        else if (precipP >= 10 || probP >= 50 || wxMax >= 61) pt = 'Moderado';

        periodos[nome] = { precip: precipP.toFixed(1), prob: probP, wx: wxMax, pt, tMax, tMin };
      }

      dadosClimaPorSub[sub.id] = {
        current: r.current || {},
        precip3hPassada, precip3hFutura, probMax3h, precipAgora,
        periodos
      };
    });
    return true;
  } catch (e) {
    console.error('Erro Open-Meteo:', e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAPA LEAFLET
// ═══════════════════════════════════════════════════════════════
const TILES = {
  openstreetmap: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OSM', maxZoom: 19 }),
  satelite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '&copy; Esri', maxZoom: 19 }),
  topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenTopoMap', maxZoom: 17 })
};

const mapa = L.map('mapa', { center: [-23.485, -46.625], zoom: 13, layers: [TILES[MAPA_TIPO]] });
let camadaAtual = MAPA_TIPO;
const layers = { poligonos: L.layerGroup().addTo(mapa), pontos: L.layerGroup().addTo(mapa) };

function trocarMapa(tipo) {
  if (TILES[camadaAtual]) mapa.removeLayer(TILES[camadaAtual]);
  if (TILES[tipo]) TILES[tipo].addTo(mapa);
  camadaAtual = tipo;
}

function desenharPoligonos() {
  layers.poligonos.clearLayers();
  SUBS.forEach(sp => {
    if (!FILTRO.includes(sp.id)) return;
    const c = POLIGONOS[sp.id];
    if (!c) return;
    L.polygon(c, { color: sp.cor, weight: 2, fillColor: sp.cor, fillOpacity: 0.10, dashArray: '6 3' })
      .bindTooltip(sp.nome, { sticky: true }).addTo(layers.poligonos);
  });
}

// ═══════════════════════════════════════════════════════════════
// RENDER — PONTOS COM RISCO DINÂMICO
// ═══════════════════════════════════════════════════════════════
let pontosComRisco = [];

function renderizarPontos() {
  layers.pontos.clearLayers();
  pontosComRisco = [];

  PONTOS.forEach(pt => {
    if (!FILTRO.includes(pt.sub)) return;
    const clima = dadosClimaPorSub[pt.sub] || null;
    const risco = calcularRisco(pt, clima);
    pontosComRisco.push({ ...pt, risco });

    const raio = { intransitavel: 12, transitavel: 9, atencao: 7, normal: 5 }[risco.nivel];
    const opac = { intransitavel: 0.7, transitavel: 0.5, atencao: 0.35, normal: 0.2 }[risco.nivel];

    L.circleMarker([pt.lat, pt.lng], {
      radius: raio, color: risco.cor, fillColor: risco.cor, fillOpacity: opac, weight: 2
    }).bindPopup(`
      <div style="font-family:Montserrat,sans-serif;font-size:13px;max-width:280px">
        <strong style="font-size:14px">${pt.rua}</strong><br>
        <span style="display:inline-block;margin:4px 0;padding:2px 8px;border-radius:4px;background:${risco.cor}20;color:${risco.cor};font-weight:700;font-size:13px">${risco.label}</span>
        <hr style="margin:6px 0;border:none;border-top:1px solid #e5e5ea">
        <strong>Dados via Open-Meteo API:</strong><br>
        Precipitação agora: <strong>${risco.chuvaAgora} mm</strong><br>
        Acumulado ajustado (6h): <strong>${risco.precip3h} mm</strong><br>
        Prob. máx. chuva (3h): <strong>${risco.prob}%</strong>
        <hr style="margin:6px 0;border:none;border-top:1px solid #e5e5ea">
        <span style="color:#8e8e93;font-size:11px">
          Tipo: ${pt.tipo} · Cota: ${pt.cota}m · Peso: ${TIPO_PESO[pt.tipo]}x<br>
          Classificação calculada automaticamente
        </span>
      </div>
    `).addTo(layers.pontos);
  });

  renderListaSidebar();
  renderResumo();
  renderAlerta();
}

function renderListaSidebar() {
  const el = document.getElementById('point-list');
  const ordem = { intransitavel: 0, transitavel: 1, atencao: 2, normal: 3 };
  const sorted = [...pontosComRisco].sort((a, b) => ordem[a.risco.nivel] - ordem[b.risco.nivel]);

  el.innerHTML = sorted.map(pt => `
    <div class="point-item" onclick="mapa.setView([${pt.lat},${pt.lng}],16)">
      <span class="dot" style="background:${pt.risco.cor}"></span>
      <div>
        <div class="street">${pt.rua}</div>
        <div class="meta">${pt.risco.label} · Acum: ${pt.risco.precip3h}mm · Prob: ${pt.risco.prob}%</div>
      </div>
    </div>
  `).join('');
}

function renderResumo() {
  const c = { intransitavel: 0, transitavel: 0, atencao: 0, normal: 0 };
  pontosComRisco.forEach(p => c[p.risco.nivel]++);
  const ativos = c.intransitavel + c.transitavel;

  document.getElementById('flood-total').innerHTML =
    `Pontos de Alagamento: <span>${ativos}</span> ativos de ${pontosComRisco.length} monitorados`;

  document.getElementById('flood-status').innerHTML = `
    <div class="flood-box intransitavel"><div class="num">${c.intransitavel}</div><div class="lbl">Intransitáveis</div></div>
    <div class="flood-box transitavel"><div class="num">${c.transitavel}</div><div class="lbl">Transitáveis</div></div>
    <div class="flood-box atencao"><div class="num">${c.atencao}</div><div class="lbl">Atenção</div></div>
    <div class="flood-box normal"><div class="num">${c.normal}</div><div class="lbl">Normal</div></div>
  `;
}

function renderAlerta() {
  const panel = document.getElementById('panel-alert');
  const ni = pontosComRisco.filter(p => p.risco.nivel === 'intransitavel').length;
  const nt = pontosComRisco.filter(p => p.risco.nivel === 'transitavel').length;
  const na = pontosComRisco.filter(p => p.risco.nivel === 'atencao').length;

  if (ni > 0) {
    panel.className = 'panel panel-alert show critical';
    panel.innerHTML = `⚠ ALERTA: ${ni} ponto(s) intransitável(is) — Chuva forte detectada via API`;
  } else if (nt > 0) {
    panel.className = 'panel panel-alert show warning';
    panel.innerHTML = `⚠ ATENÇÃO: ${nt} ponto(s) com alagamento transitável`;
  } else if (na > 0) {
    panel.className = 'panel panel-alert show watch';
    panel.innerHTML = `Observação: ${na} ponto(s) em atenção — monitorando precipitação`;
  } else {
    panel.className = 'panel panel-alert';
  }
}

// ═══════════════════════════════════════════════════════════════
// RENDER — CLIMA SIDEBAR (estilo CGE)
// ═══════════════════════════════════════════════════════════════
function renderClimaSidebar() {
  const ref = dadosClimaPorSub[FILTRO[0]] || dadosClimaPorSub['cv'];
  const el  = document.getElementById('card-clima');
  if (!ref?.current) { el.innerHTML = '<div style="color:#FF3B30">Erro ao obter dados</div>'; return; }

  const c = ref.current;
  const p = ref.periodos;

  const ptColor = pt => pt === 'Alto' ? '#FF3B30' : pt === 'Moderado' ? '#FF9500' : '#34C759';

  const periodCard = (nome, icon, d) => `
    <div class="period">
      <strong>${icon} ${nome}</strong>
      ${wxEmoji(d.wx)} ${wxText(d.wx)}<br>
      ${d.precip}mm · ${d.prob}%<br>
      <strong style="color:${ptColor(d.pt)}">PT: ${d.pt}</strong>
      ${d.tMin != null ? `<br>${d.tMin.toFixed(0)}°–${d.tMax.toFixed(0)}°` : ''}
    </div>`;

  el.innerHTML = `
    <div class="temp-row">
      <div>
        <div class="temp-big">${c.temperature_2m}°C</div>
        <div class="detail">${wxEmoji(c.weather_code)} ${wxText(c.weather_code)}</div>
      </div>
      <div style="text-align:right">
        <div class="temp-label">Sensação</div>
        <div style="font-size:1.2rem;font-weight:700">${c.apparent_temperature}°</div>
      </div>
    </div>
    <div class="detail">Umidade: ${c.relative_humidity_2m}% · Vento: ${c.wind_speed_10m} km/h</div>
    <div class="detail">Chuva agora: ${c.precipitation || 0}mm · Acum. 3h: ${ref.precip3hPassada.toFixed(1)}mm</div>
    <div class="detail" style="margin-top:4px;font-weight:600">Prev. próx. 3h: ${ref.precip3hFutura.toFixed(1)}mm (prob. ${ref.probMax3h}%)</div>
    <div class="period-grid">
      ${p.madrugada ? periodCard('Madrug.', '🌙', p.madrugada) : ''}
      ${p.manha     ? periodCard('Manhã', '🌅', p.manha) : ''}
      ${p.tarde     ? periodCard('Tarde', '☀️', p.tarde) : ''}
      ${p.noite     ? periodCard('Noite', '🌙', p.noite) : ''}
    </div>
    <div style="margin-top:6px;font-size:.68rem;color:#8e8e93;text-align:center">
      PT = Potencial de Tempestade (ref. CGE-SP) · Dados: Open-Meteo API
    </div>
  `;
}

function renderClimaMapa() {
  const ref = dadosClimaPorSub[FILTRO[0]] || dadosClimaPorSub['cv'];
  const el  = document.getElementById('weather-mini');
  if (!ref?.current) { el.innerHTML = 'Sem dados'; return; }
  const c = ref.current;
  el.innerHTML = `
    <div style="font-size:1.4rem;font-weight:800">${c.temperature_2m}°C</div>
    <div>${wxEmoji(c.weather_code)} ${wxText(c.weather_code)}</div>
    <div>Chuva: ${c.precipitation||0}mm · Umid: ${c.relative_humidity_2m}%</div>
    <div>Acum. 3h: ${ref.precip3hPassada.toFixed(1)}mm</div>
    <div>Prev. 3h: ${ref.precip3hFutura.toFixed(1)}mm (${ref.probMax3h}%)</div>
    <div style="margin-top:4px;font-size:.7rem;color:#8e8e93">Atualizado: ${new Date().toLocaleTimeString('pt-BR')}</div>
  `;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS — Weather code → emoji/text
// ═══════════════════════════════════════════════════════════════
function wxEmoji(c) {
  if (c <= 1) return '☀️'; if (c <= 3) return '⛅'; if (c <= 48) return '🌫️';
  if (c <= 55) return '🌦️'; if (c <= 65) return '🌧️'; if (c <= 82) return '🌧️';
  if (c >= 95) return '⛈️'; return '🌤️';
}
function wxText(c) {
  const m = {0:'Céu limpo',1:'Quase limpo',2:'Parc. nublado',3:'Nublado',
    45:'Névoa',48:'Névoa gelada',51:'Garoa leve',53:'Garoa mod.',55:'Garoa forte',
    61:'Chuva leve',63:'Chuva mod.',65:'Chuva forte',
    80:'Pancadas leves',81:'Pancadas mod.',82:'Pancadas fortes',
    95:'Trovoadas',96:'Trov.+granizo',99:'Trov.+granizo forte'};
  return m[c] || `Cód.${c}`;
}

// ═══════════════════════════════════════════════════════════════
// BUSCA ENDEREÇO (Nominatim / OSM)
// ═══════════════════════════════════════════════════════════════
async function buscarEndereco(end) {
  if (!end) return;
  try {
    const q = encodeURIComponent(end + ', Zona Norte, São Paulo, Brazil');
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1`);
    const data = await res.json();
    if (data.length) {
      const {lat, lon, display_name} = data[0];
      mapa.setView([+lat, +lon], 16);
      L.marker([+lat, +lon]).addTo(mapa).bindPopup(`<strong>Busca:</strong><br>${display_name}`).openPopup();
    }
  } catch(e) { console.error(e); }
}

// ═══════════════════════════════════════════════════════════════
// CLIQUE NO MAPA → identifica rua e proximidade de alagamento
// ═══════════════════════════════════════════════════════════════
mapa.on('click', async e => {
  const {lat, lng} = e.latlng;
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18`);
    const data = await res.json();
    const a = data.address || {};
    const rua = a.road || a.pedestrian || 'Sem nome';
    const bairro = a.suburb || a.neighbourhood || '';

    let prox = null, menorDist = Infinity;
    pontosComRisco.forEach(p => {
      const d = Math.sqrt((p.lat-lat)**2 + (p.lng-lng)**2);
      if (d < 0.003 && d < menorDist) { prox = p; menorDist = d; }
    });

    L.popup().setLatLng(e.latlng).setContent(`
      <div style="font-family:Montserrat,sans-serif;font-size:13px">
        <strong>${rua}</strong>${bairro ? ` — ${bairro}` : ''}<br>
        ${prox
          ? `<span style="color:${prox.risco.cor};font-weight:700">⚠ Próx.: ${prox.rua}<br>Status: ${prox.risco.label} (${prox.risco.precip3h}mm acum.)</span>`
          : '<span style="color:#34C759">✓ Sem ponto de alagamento próximo</span>'}
      </div>
    `).openOn(mapa);
  } catch(e) {}
});

// ═══════════════════════════════════════════════════════════════
// FILTRO DINÂMICO
// ═══════════════════════════════════════════════════════════════
function atualizarTudo() {
  FILTRO = [...document.querySelectorAll('input[name="sub[]"]:checked')].map(c => c.value);
  desenharPoligonos();
  renderizarPontos();
  renderClimaSidebar();
  renderClimaMapa();
}

// ═══════════════════════════════════════════════════════════════
// RELÓGIO
// ═══════════════════════════════════════════════════════════════
function tick() {
  const d = new Date();
  document.getElementById('relogio').textContent = d.toLocaleDateString('pt-BR', {
    weekday:'long', day:'2-digit', month:'2-digit', year:'numeric'
  }) + ' — ' + d.toLocaleTimeString('pt-BR');
}
setInterval(tick, 1000); tick();

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
(async function() {
  desenharPoligonos();
  const ok = await fetchClimaOpenMeteo();
  if (ok) {
    renderizarPontos();
    renderClimaSidebar();
    renderClimaMapa();
  } else {
    document.getElementById('card-clima').innerHTML = '<div style="color:#FF3B30">Falha na conexão com Open-Meteo</div>';
    document.getElementById('flood-total').innerHTML = 'Sem dados — impossível calcular risco';
  }
  if (BUSCA) buscarEndereco(BUSCA);

  // Auto-refresh 5 min
  setInterval(async () => {
    if (await fetchClimaOpenMeteo()) {
      renderizarPontos();
      renderClimaSidebar();
      renderClimaMapa();
    }
  }, 5 * 60 * 1000);
})();
</script>
</body>
</html>