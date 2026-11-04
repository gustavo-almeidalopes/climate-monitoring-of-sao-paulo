# ClimaSP Backend

Backend em FastAPI para monitoramento climatico de regioes de Sao Paulo.

## Endpoints

- `GET /` - Painel (index.html); `styles.css`, `config.js` e `js/*` servidos ao lado
- `GET /health` - Health check com status das fontes, scheduler e frescor dos dados
- `GET /api/v1/weather/regions` - Lista regioes monitoradas
- `GET /api/v1/weather/current` - Dados atuais de todas as regioes
- `GET /api/v1/weather/current/{id}` - Dados atuais de uma regiao
- `GET /api/v1/weather/forecast/{id}` - Previsao (padrao: 48h)
- `GET /api/v1/weather/history/{id}` - Historico com estatisticas (ate 7 dias)
- `POST /api/v1/weather/refresh` - Atualiza todas as regioes (forcado ou apenas stale)
- `GET /api/v1/weather/metrics` - Indicadores operacionais de frescor por regiao
- `GET /api/v1/weather/overview` - Painel numa chamada: leitura atual com nivel unificado, serie horaria -24 h...+48 h, tendencia de 6 h e nowcast do modelo por regiao (aditivo)
- `GET /api/v1/weather/thresholds` - Limiares de chuva (5/20/40 mm/h) e cortes do indice de risco (25/50/75)
- `/api/v1/ops/*` - Operacao (Fase 3), exige credencial: `me`, `teams` (GET/PATCH), `incidents` (abrir, `assign`, `arrive`, `resolve`), `report` (indicadores pos-evento)
- `GET /api/v1/ml/status` - Versao do modelo, metricas vs. baselines, importancia das features, job de treino
- `GET /api/v1/ml/predict/{id}` - Nowcast: probabilidade de chuva forte nas proximas horas, chuva esperada e risco 0-100 (observado + previsao)
- `GET /api/v1/ml/dataset` - Cobertura da serie horaria real armazenada (por regiao e fonte)
- `GET /api/v1/ml/runs` - Historico das execucoes de treino
- `POST /api/v1/ml/ingest?years=3` - Baixa (incremental) o historico horario real
- `POST /api/v1/ml/train?years=3` - Coleta + treino em background (`/train/sync` aguarda o fim)

## Front-end (painel)

Site estático, sem build: `index.html` (marcação + sprite de ícones SVG), `styles.css`, `config.js` e
módulos ES nativos em `js/`. É o mesmo conjunto publicado na Vercel e servido pelo FastAPI em `/`.

| Módulo | Papel |
|---|---|
| `js/store.js` | Store central com assinantes (`subscribe(seletor, callback)`) |
| `js/state.js` | Estado global: conexão, origem dos dados (real/exemplo), regiões, limiares, alertas |
| `js/weather.js` | Busca `/weather/thresholds` e `/weather/current`, atualização automática a cada 5 min |
| `js/risk.js` | Critério único de nível de perigo (espelha `app/core/risk_levels.py`) |
| `js/insights.js` | Veredito, tendência, idade do dado, previsão e empate entre regiões |
| `js/status.js` | Indicador de conexão, banner de modo offline, veredito e números de apoio |
| `js/regionlist.js` | Lista de regiões por nível e painel de detalhe ("Próximas 3 h", gráficos) |
| `js/charts.js` | Gráficos em SVG (mini-gráfico, chuva por hora, linha de risco) + tabela |
| `js/map.js` | Leaflet: mapa base por tema, distritos e grade hexagonal pintados pelo nível, rótulos |
| `js/timeline.js` | Linha do tempo −24 h…+48 h com animação |
| `js/layers.js` / `js/cluster.js` | Camadas de dados reais e agrupamento de marcadores |
| `js/geolocate.js` | Botão "minha localização" |
| `js/alerts.js` | Faixa de alerta com memória por nível e histórico (sino) |
| `js/search.js` | Busca (Nominatim) com o nível de perigo da subprefeitura do ponto |
| `js/news.js` | Gaveta de notícias |
| `js/operator.js` | Modo operador (limiares locais) |

Cada módulo assina a fatia do estado que exibe e se redesenha sozinho; não há chamadas de render
manuais entre módulos.

**URL do backend** — edite `config.js` (`window.CLIMASP_API_BASE = "https://seu-backend"`). Vazio =
`http://localhost:8000` em desenvolvimento e a própria origem nos demais casos. Na Vercel o site é só
estático: sem essa URL o painel mostra o banner "Sem conexão — dados de exemplo".

**Critério único de nível** — o nível de perigo é o pior entre a chuva observada na última hora
(limiares CEMADEN/Defesa Civil 5/20/40 mm/h) e o índice de risco 0–100 nos cortes 25/50/75, este só
quando calculado pelo modelo (`risk_source = "ml"`). O índice heurístico (servidor sem modelo) não
sobe o nível. Mapa, lista, popups, alertas e veredito usam a mesma regra.

**"Próximas 3 h"** — mostra a chuva prevista hora a hora (Open-Meteo) e a probabilidade de chuva
forte do modelo, sempre acompanhada da qualidade medida do modelo (precisão e detecção no período
de teste). Hoje o modelo ainda não supera a climatologia; o painel diz isso explicitamente.

**Modo offline** — sem servidor, o painel exibe valores de exemplo acinzentados, marcados como
"exemplo", com banner explícito e sem alertas. Se a conexão cai depois de uma leitura real, mantém a
última leitura e informa o horário dela.

**Modo operador** — os limiares ficam ocultos para o público. Abra com `?operador=1` (vale para a
sessão da aba; `?operador=0` ou o botão "Sair" desliga). Limiares ajustados valem só naquele
navegador e são sinalizados na legenda. Não é controle de acesso.

**Rodar localmente** — módulos ES não funcionam abrindo o arquivo direto (`file://`); sirva por HTTP:

```bash
uvicorn app.main:app --reload --port 8000   # API + painel em http://localhost:8000
```

ou, só o front-end (a API continua em `localhost:8000`):

```bash
python3 -m http.server 4173
```

**Testes do front-end** (Playwright + axe, com rede simulada):

```bash
cd e2e && npm ci && npx playwright install chromium
npx playwright test --grep-invert @screenshot
SHOT_PREFIX=depois npx playwright test --grep @screenshot   # capturas em docs/screenshots/fase-0/
```

### Camadas geográficas (Fase 2)

Geradas por `scripts/build_geodata.py` no workflow **Dados geográficos** (GitHub Actions, que tem
acesso às fontes) e versionadas em `data/geo/`, com a procedência em `data/geo/metadata.json` e o
relatório de sondagem/licenças em `docs/fase-2/fontes.md`. Para regenerar, rode o workflow
manualmente (ou altere o script).

| Camada | Fonte | Licença |
|---|---|---|
| Grade hexagonal H3 (res. 9) dos 11 distritos | limites: GeoSampa via codigourbano/distritos-sp | — |
| Altitude por célula | Copernicus DEM GLO-90 via Open-Meteo | CC BY 4.0 |
| Cursos d'água, vias, hospitais e bombeiros | OpenStreetMap (Overpass) | ODbL 1.0 |
| Ocorrências de alagamento/inundação, área inundável (PDMAT3), risco hidrológico | GeoSampa WFS (Prefeitura de SP) | WFS sem restrição de acesso; conjuntos do GeoSampa publicados em CC0 no portal de dados abertos |
| Radar de chuva (no navegador) | RainViewer | uso gratuito com atribuição obrigatória |

**Suscetibilidade por célula (experimental)**: terreno baixo (absoluto e relativo à vizinhança),
proximidade de curso d'água e histórico de ocorrências do GeoSampa. As 10% células mais suscetíveis
sobem um nível quando a região já está em Médio ou acima; nunca descem.

As "vias alagáveis" (Marginal Tietê, Av. Braz Leme) são os exemplos citados no roadmap; a geometria
vem do OSM, mas a classificação ainda precisa ser confirmada com o histórico do CGE.

Créditos: ícones no estilo [Feather Icons](https://feathericons.com) (MIT); mapas base © OpenStreetMap,
© CARTO e © Esri; radar © RainViewer; relevo Copernicus DEM (© DLR e.V. 2010-2014 e © Airbus Defence
and Space GmbH 2014-2018, via Open-Meteo); camadas de risco © GeoSampa/Prefeitura de São Paulo; limites dos distritos do [GeoSampa](https://geosampa.prefeitura.sp.gov.br) via
[codigourbano/distritos-sp](https://github.com/codigourbano/distritos-sp).

## Operação (Fase 3)

**Perfis**: cidadão (sem login: alertas, mapa, previsão), **operador** (equipes, despacho,
ocorrências, limiares) e **gestor** (indicadores, somente leitura). As credenciais são tokens em
variáveis de ambiente do servidor:

```bash
export OPERATOR_TOKEN="$(openssl rand -hex 16)"
export MANAGER_TOKEN="$(openssl rand -hex 16)"
```

Sem eles, as rotas `/api/v1/ops/*` respondem 503. No painel, abra com `?operador=1`, vá à aba
**Operação** e entre com a credencial (fica só naquela aba do navegador). É um controle simples
para piloto; em produção, troque por login individual.

- **Equipes**: Defesa Civil, Bombeiros, CET, SAMU e subprefeitura, com status (disponível, em
  deslocamento, em ocorrência, indisponível). **São dados de EXEMPLO (fictícios)** até haver
  integração com os sistemas reais — rotulados em todo lugar. As bases ficam em instalações reais
  do OpenStreetMap (quartéis e hospitais) ou no centro de cada subprefeitura.
- **3 equipes mais rápidas**: "Escolher ponto no mapa" → tempo de chegada **por ruas** (OSRM, carro,
  sem trânsito), com rotas alternativas que evitam células em nível Crítico quando custam até 50%
  a mais; trechos críticos são destacados. Sem OSRM, aparece "estimativa em linha reta".
- **Despacho e ocorrências**: abrir → equipe designada → no local → resolvida, com linha do tempo.
- **Cobertura (isócronas 5/10/15 min)**: minutos de cada base até cada célula da grade, calculados
  no CI (`data/geo/coverage.json`); células acima de 15 min aparecem hachuradas (buracos).
- **Pré-posicionamento**: quando há chuva forte prevista (próximas 3 h) ou alerta do modelo numa
  região, sugere levar a equipe de Defesa Civil/Bombeiros mais rápida até a célula mais suscetível.
- **Relatório pós-evento** (`/ops/report`): chuva acumulada, ocorrências, tempos até despacho,
  chegada e resolução, e **acerto do modelo** — cada nowcast servido é registrado e comparado depois
  com a chuva observada.

O servidor de rotas é configurável em `config.js` (`CLIMASP_OSRM_URL`); o padrão é o servidor
público de demonstração do OSRM (uso moderado, sem garantia). Se as bases das equipes de exemplo
mudarem, regenere `data/geo/example-bases.json` (há um teste que acusa a diferença) e rode o
workflow de dados.

## Desenvolvimento no Simulador iOS (macOS)

O ClimaSP é um app web: roda no Safari de um iPhone no Simulador iOS, sem projeto Xcode e sem
CocoaPods. Os scripts em `scripts/ios/` (bash 3.2, instalam só o que falta, nunca atualizam o que
já existe) e o `CLAUDE.md` deixam o Claude Code usar o simulador como ambiente principal.

```bash
scripts/ios/doctor.sh      # diagnóstico (macOS, Xcode, runtime iOS, Python, Node, idb)
scripts/ios/setup.sh       # instala o que falta (.venv, idb, fswatch, Playwright WebKit)
scripts/ios/run.sh --watch # backend com recarga + Safari no iPhone + recarga automática do front
```

| Script | Para quê |
|---|---|
| `shot.sh [nome]` | screenshot do simulador em `logs/ios/` |
| `ui.sh tree / tap X Y / type "…" / swipe` | inspecionar a árvore de acessibilidade e interagir (idb) |
| `logs.sh [--follow / --safari]` | servidor, erros do navegador (`logs/client.log`) e log do WebKit |
| `reload.sh`, `stop.sh` | recarregar a página; parar servidor e simulador |
| `test.sh` | regressão: pytest + Playwright (Chromium e, no Mac, iPhone WebKit) |

O `.mcp.json` registra o servidor MCP `ios-simulator` (screenshots, toques, digitação, árvore de
acessibilidade) para o Claude Code. Os erros do Safari chegam ao servidor porque o `run.sh` abre o
app com `?dev=1` e liga `DEV_CLIENT_LOG=true`.

## Machine Learning com dados reais

O risco de alagamento e calculado por um modelo treinado com **dados meteorologicos reais**:

1. **Ingestao** — para cada regiao, a serie horaria historica da
   [Open-Meteo Historical API](https://open-meteo.com/en/docs/historical-weather-api) (reanalise ERA5,
   sem chave) e gravada na tabela `hourly_observations` (temperatura, umidade, ponto de orvalho,
   precipitacao, pressao ao nivel do mar, nebulosidade, vento, rajada e direcao). As ultimas horas
   (que a reanalise ainda nao cobre, ~5 dias de atraso) vem da Forecast API com `past_days`; as
   proximas horas previstas ficam em memoria para pontuar a previsao.
2. **Alvo sem vazamento** — o modelo preve se a chuva acumulada nas **proximas 3 h** vai passar de
   10 mm (configuravel). As features da hora `t` usam apenas dados ate `t`: chuva acumulada
   (1h a 7 dias), horas desde a ultima chuva, tendencia de pressao (3/6/24 h), depressao do ponto de
   orvalho, variacao de umidade/nebulosidade, componentes u/v do vento, ciclo diario e sazonal.
3. **Treino e avaliacao honesta** — `HistGradientBoostingClassifier` (probabilidade de chuva forte) +
   `HistGradientBoostingRegressor` Poisson (mm esperados). Divisao **temporal** (o teste e o periodo
   mais recente, com embargo), limiar de decisao escolhido na validacao, comparacao com baselines de
   **climatologia** e **persistencia**, importancia por permutacao. Depois o modelo final e
   re-treinado com todo o historico e salvo com os metadados (`models/*.joblib` + `.json`). Cada
   execucao fica registrada na tabela `model_runs`.
4. **Inferencia** — risco = `1 - (1 - observado) x (1 - P(chuva forte))`, em que o componente observado
   usa a chuva real ja acumulada (40 mm/h, 60 mm/3h, 100 mm/24h saturam). E aplicado ao dado atual e
   a cada hora da previsao de 48 h. Sem modelo treinado, a API volta para a heuristica antiga.
5. **Operacao automatica** — no boot, se nao houver modelo, coleta o historico e treina em background
   (`ML_AUTO_BOOTSTRAP`). Observacoes recentes sao sincronizadas a cada hora e o modelo e re-treinado
   semanalmente com os dados novos.

Treino manual pela linha de comando:

```bash
python scripts/collect_and_train.py --years 3
```

Limitacoes: a reanalise ERA5 tem grade de ~9-25 km, entao as 4 regioes compartilham praticamente o
mesmo ponto de grade e picos convectivos ficam suavizados. Se houver poucos eventos acima do limiar,
o treino relaxa o limiar (7,5 -> 5 -> 3 mm/3h) e registra o valor usado nos metadados.

## Melhorias recentes

- Refresh inteligente: atualiza apenas regioes stale por TTL configuravel
- Fallback de continuidade: se API externa cair, retorna ultimo dado local quando existir
- Scheduler observavel: status, ultimo sucesso/erro e proxima execucao no health
- Politica de retencao automatica: limpeza de historico e previsoes antigas
- Endpoint de metrics para monitoramento operacional

## Setup rapido

```bash
cd climasp-backend
python -m venv venv
# Linux/macOS
source venv/bin/activate
# Windows
# venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --port 8000
```

## Variaveis uteis

- `SCHEDULER_INTERVAL_MINUTES` (default `10`)
- `CURRENT_DATA_TTL_MINUTES` (default `20`)
- `HISTORY_MAX_DAYS` (default `7`)
- `HISTORY_RETENTION_DAYS` (default `30`)
- `FORECAST_RETENTION_HOURS` (default `96`)
- `OPENWEATHER_API_KEY` (opcional)
- `ML_TRAINING_HISTORY_YEARS` (default `3`)
- `ML_HORIZON_HOURS` (default `3`) / `ML_HEAVY_RAIN_MM` (default `10`)
- `ML_AUTO_BOOTSTRAP` (default `true`)
- `ML_SYNC_INTERVAL_MINUTES` (default `60`) / `ML_RETRAIN_INTERVAL_HOURS` (default `168`)

## Testes

```bash
pip install -r requirements-dev.txt
pytest -q
```

Os testes rodam offline: simulam a Open-Meteo e cobrem ingestao incremental, ausencia de vazamento
nas features, treino, recarga do modelo e predicao.

## Patterns implementados

- Token Bucket (`app/services/http_client.py`)
- Circuit Breaker (`app/services/http_client.py`)
- Retry + Backoff (`app/services/http_client.py`)
- Fallback Chain (`app/services/weather_service.py`)
- Strategy por provider (`app/services/providers/*`)
- Repository (`app/services/storage_service.py`)
- Dependency Injection (`Depends(get_db)` e `Depends(get_weather_service)`)
- Singleton (`app/api/deps.py`)
