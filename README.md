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
| `js/risk.js` | Critério único de nível de perigo (mapa, cartões, popups, busca e alertas) |
| `js/map.js` | Leaflet: mapa base que segue o tema, distritos, zonas, popups |
| `js/alerts.js` | Faixa de alerta com memória por nível e histórico (sino) |
| `js/status.js` | Indicador de conexão, banner de modo offline e cartões de resumo |
| `js/search.js` | Busca (Nominatim) com o nível de perigo da subprefeitura do ponto |
| `js/news.js` | Gaveta de notícias |
| `js/operator.js` | Modo operador (limiares locais) |

Cada módulo assina a fatia do estado que exibe e se redesenha sozinho; não há chamadas de render
manuais entre módulos.

**URL do backend** — edite `config.js` (`window.CLIMASP_API_BASE = "https://seu-backend"`). Vazio =
`http://localhost:8000` em desenvolvimento e a própria origem nos demais casos. Na Vercel o site é só
estático: sem essa URL o painel mostra o banner "Sem conexão — dados de exemplo".

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

Créditos: ícones no estilo [Feather Icons](https://feathericons.com) (MIT); mapas base © OpenStreetMap,
© CARTO e © Esri; limites dos distritos do [GeoSampa](https://geosampa.prefeitura.sp.gov.br) via
[codigourbano/distritos-sp](https://github.com/codigourbano/distritos-sp).

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
