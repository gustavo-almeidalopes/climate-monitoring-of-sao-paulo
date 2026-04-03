# ClimaSP Backend

Backend em FastAPI para monitoramento climatico de regioes de Sao Paulo.

## Endpoints

- `GET /` - Info da API
- `GET /health` - Health check com status das fontes, scheduler e frescor dos dados
- `GET /api/v1/weather/regions` - Lista regioes monitoradas
- `GET /api/v1/weather/current` - Dados atuais de todas as regioes
- `GET /api/v1/weather/current/{id}` - Dados atuais de uma regiao
- `GET /api/v1/weather/forecast/{id}` - Previsao (padrao: 48h)
- `GET /api/v1/weather/history/{id}` - Historico com estatisticas (ate 7 dias)
- `POST /api/v1/weather/refresh` - Atualiza todas as regioes (forcado ou apenas stale)
- `GET /api/v1/weather/metrics` - Indicadores operacionais de frescor por regiao

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

## Patterns implementados

- Token Bucket (`app/services/http_client.py`)
- Circuit Breaker (`app/services/http_client.py`)
- Retry + Backoff (`app/services/http_client.py`)
- Fallback Chain (`app/services/weather_service.py`)
- Strategy por provider (`app/services/providers/*`)
- Repository (`app/services/storage_service.py`)
- Dependency Injection (`Depends(get_db)` e `Depends(get_weather_service)`)
- Singleton (`app/api/deps.py`)
