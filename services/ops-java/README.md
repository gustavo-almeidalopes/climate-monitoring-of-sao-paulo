# climasp-ops — serviço de operação em Java

Equipes, ocorrências, despacho por tempo de chegada e consultas geográficas do ClimaSP, em
**Java 21 + Spring Boot 3** com **PostgreSQL/PostGIS**. Ele roda **ao lado** do backend Python,
seguindo o padrão *strangler*. Atrás do gateway (`deploy/nginx.conf`), assume `/api/v1/ops/*` e
`/api/v1/geo/*`. Clima, previsão e ML continuam no FastAPI. Nenhuma rota existente muda.

## O que ele faz

| Rota | Perfil | O que faz |
|---|---|---|
| `GET /api/v1/ops/me` | operador ou gestor | valida a credencial |
| `GET/PATCH /api/v1/ops/teams[/{id}]` | gestor / operador | equipes (status, posição) |
| `GET/POST /api/v1/ops/incidents` e `/{id}/assign`, `/arrive` e `/resolve` | gestor / operador | ciclo da ocorrência com linha do tempo |
| `GET /api/v1/ops/report?hours=24` | gestor | relatório pós-evento |
| `GET /api/v1/ops/nearest?lat=&lng=` | gestor | **novo**: equipes mais rápidas por ruas, com rotas e alternativas |
| `GET /api/v1/ops/coverage?kind=` | gestor | **novo**: isócronas, o menor tempo das bases até cada célula H3 |
| `GET /api/v1/geo/point?lat=&lng=` | público | **novo**: diz se o ponto está em zona de risco (célula H3, distrito e áreas oficiais do GeoSampa) |

O contrato JSON, as mensagens de erro (`{"detail": ...}`) e os perfis são os mesmos do backend
Python (`app/controllers/ops_controller.py`, `app/core/security.py`). Os testes de integração
verificam isso contra um PostGIS real.

- **Relatório:** os indicadores de ocorrências são calculados aqui. A chuva acumulada e o acerto do
  modelo vêm do Python em `/api/v1/ops/report/context`, com a credencial de quem pediu.
- **Equipes de exemplo:** são **fictícias** (`[EXEMPLO]`), semeadas de `data/geo/example-teams.json`.
  Esse arquivo é gerado pelo Python (`scripts/export_example_teams.py`), então as duas
  implementações têm as mesmas equipes.
- **Camadas geográficas:** são importadas para o PostGIS na primeira subida, a partir de
  `data/geo/` (grade H3 e polígonos do GeoSampa). São as mesmas fontes do mapa, sem dado novo.
- **Documentação OpenAPI:** fica em `/api/v1/ops-java/openapi.json` e na interface `/api/v1/ops-java/docs`.

## Motor de rotas

`ROUTING_ENGINE=auto` (padrão) escolhe, em ordem:

1. **GraphHopper embutido**, se `OSM_FILE` apontar para um extrato do OpenStreetMap. Por exemplo,
   `sudeste-latest.osm.pbf` da Geofabrik, licença ODbL. O grafo de carro é montado na primeira
   subida e fica em cache em `GRAPH_CACHE_DIR`. As isócronas saem de uma árvore de menor caminho
   por base, e não de uma rota por célula.
2. **OSRM**, se `OSRM_URL` estiver definido.
3. **Estimativa em linha reta**: distância × 1,4 a 25 km/h, a mesma fórmula do front, **sempre
   rotulada** como estimativa.

Pontos fora da malha viária nunca recebem um tempo inventado: ficam sem rota ou com a
estimativa rotulada.

## Rodar

```bash
cd services/ops-java
mvn test                        # 11 testes; os *IT sobem PostGIS com Testcontainers (exige Docker)
OPERATOR_TOKEN=op MANAGER_TOKEN=gestor DATABASE_URL=jdbc:postgresql://localhost:5432/climasp mvn spring-boot:run
```

Com o projeto inteiro (PostGIS, Python, Java e gateway): `docker compose up` na raiz (ver README principal).

## Variáveis

| Variável | Padrão | Uso |
|---|---|---|
| `DATABASE_URL`, `DATABASE_USER`, `DATABASE_PASSWORD` | `localhost/climasp` | PostgreSQL com PostGIS |
| `OPERATOR_TOKEN`, `MANAGER_TOKEN` | vazio, o que dá 503 | mesmos tokens do backend Python |
| `PYTHON_API_URL` | `http://localhost:8000` | contexto de clima do relatório |
| `GEO_DATA_DIR` | `../../data/geo` | arquivos importados para o PostGIS |
| `ROUTING_ENGINE` | `auto` | `auto`, `graphhopper`, `osrm` ou `estimativa` |
| `OSM_FILE`, `GRAPH_CACHE_DIR` | vazio, `graph-cache` | GraphHopper |
| `OSRM_URL` | vazio | OSRM próprio |
| `OPS_SEED_EXAMPLES` | `true` | semeia as equipes fictícias se a tabela estiver vazia |
