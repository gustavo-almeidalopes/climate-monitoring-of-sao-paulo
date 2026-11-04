# Fontes de dados geográficos — sondagem de 2026-11-04T12:29:22+00:00

Gerado por `scripts/build_geodata.py` no GitHub Actions. Serve para verificar disponibilidade e licença antes de incorporar qualquer camada (nada é usado sem fonte verificada).

## Camadas geradas

- `waterways`: 691
- `flood_streets`: 172
- `support_points`: 68
- `cells`: 1458

## Problemas

- nenhum

## Sondagem de fontes externas

### GeoSampa — WFS (capabilities)

- `https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows?service=WFS&request=GetCapabilities` → HTTP 200, 420478 bytes, `application/xml`
  - Fees: “NONE”
  - AccessConstraints: “NONE”
  - Title: “Web Feature Service”
  - Abstract: “Servidor WFS corporativo.”
  - `geoportal:risco_ocorrencia_alagamento`: Alagamento — Alagamento.
  - `geoportal:risco_ocorrencia_inundacao`: Inundação — Inundação.
  - `geoportal:area_inundavel`: PDMAT3 100 anos — Área de inundação definida no 3º Plano Diretor de Macrodrenagem da Bacia do Alto Tietê para o tempo de retorno de 100 anos.
  - `geoportal:risco_hidrologico`: Risco Hidrológico — Áreas de risco de enchentes e inundações em assentamentos precários.
  - 485 camadas; relacionadas a água/risco: `geoportal:risco_ocorrencia_alagamento`, `geoportal:bacia_hidrografica`, `geoportal:caderno_drenagem`, `geoportal:risco_ocorrencia_deslizamento`, `geoportal:diagnostico_socioambiental_-_riscos`, `geoportal:drenagem`, `geoportal:hidrografia_ilha`, `geoportal:intervencao_caderno_drenagem`, `geoportal:risco_ocorrencia_inundacao`, `geoportal:sac_limpeza_enchente_evento`, `geoportal:mancha_inundacao_100`, `geoportal:mancha_inundacao_25`, `geoportal:mancha_inundacao_5`, `geoportal:hidrografia_restituida`, `geoportal:obra_drenagem_planejada`, `geoportal:area_inundavel`, `geoportal:plano_diretor_drenagem`, `geoportal:risco_ocorrencia_queda_arvore`, `geoportal:reservatorio_amortecimento`, `geoportal:area_risco_geologico`, `geoportal:risco_hidrologico`, `geoportal:risco_ocorrencia_risco_deslizamento`, `geoportal:pde_drenagem_acao_prioritaria_linear`, `geoportal:pde_drenagem_acao_prioritaria_pontual`, `geoportal:sac_sugestao_obra_drenagem_corrego`

### GeoSampa — portal

- `https://geosampa.prefeitura.sp.gov.br/PaginasPublicas/_SBC.aspx` → HTTP 200, 46693 bytes, `text/html`

### Dados abertos da Prefeitura — conjuntos do GeoSampa (licença)

- `https://dados.prefeitura.sp.gov.br/api/3/action/package_search?q=geosampa&rows=8` → HTTP 200, 126109 bytes, `application/json;charset=utf-8`
  - pacote `area-de-protecao-ambiental-apa` (Área de Proteção Ambiental (APA)): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `parques-e-unidades-de-conservacao` (Parques e Unidades de Conservação): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `cadastro-de-pracas-e-largos` (Cadastro de Praças e Largos): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `terra-indigena` (Terra Indígena): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `pagamento-por-servicos-ambientais-psa` (Pagamento por Serviços Ambientais (PSA)): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `eiv-riv-helipontos` (EIV/RIV Helipontos): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `licenca-ambiental-industrial` (Licença Ambiental Industrial): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `termo-de-compromisso-ambiental` (Termo de Compromisso Ambiental): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)

### Dados abertos da Prefeitura — alagamento (licença)

- `https://dados.prefeitura.sp.gov.br/api/3/action/package_search?q=alagamento&rows=8` → HTTP 200, 41888 bytes, `application/json;charset=utf-8`
  - pacote `relatorio-defesa-civil-2025` (Relatório Defesa Civil - 2025): licença **Creative Commons CCZero** (http://www.opendefinition.org/licenses/cc-zero)
  - pacote `reforma-de-sarjetas` (Reforma de Sarjetas/Sarjetões): licença **Creative Commons Atribuição** (http://www.opendefinition.org/licenses/cc-by)
  - pacote `manutencao-e-conservacao-de-galerias` (Manutenção e conservação de galerias): licença **Creative Commons Atribuição** (http://www.opendefinition.org/licenses/cc-by)

### CGE — alagamentos

- `https://www.cgesp.org/v3/alagamentos.jsp` → HTTP 200, 11921 bytes, `text/html;charset=UTF-8`

### RainViewer — API

- `https://api.rainviewer.com/public/weather-maps.json` → HTTP 200, 818 bytes, `application/json`
  - host `https://tilecache.rainviewer.com`; 13 quadros de radar recentes

### RainViewer — termos da API

- `https://www.rainviewer.com/api.html` → HTTP 200, 36060 bytes, `text/html`
  - trecho: “Terms of Use”
  - trecho: “Attribution is mandatory under the free terms of use and helps us continue offering the API at no cost”
  - trecho: “Attribution is mandatory under the free terms of use and helps us continue offering the API at no cost”

