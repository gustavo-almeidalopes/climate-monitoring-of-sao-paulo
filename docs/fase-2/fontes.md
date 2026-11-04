# Fontes de dados geográficos — sondagem de 2026-11-04T01:42:00+00:00

Gerado por `scripts/build_geodata.py` no GitHub Actions. Serve para verificar disponibilidade e licença antes de incorporar qualquer camada (nada é usado sem fonte verificada).

## Camadas geradas

- `waterways`: 691
- `flood_streets`: 172
- `support_points`: 68
- `cells`: 1458

## Problemas

- falha na altitude: Client error '429 Too Many Requests' for url 'https://api.open-meteo.com/v1/elevation?latitude=-23.438591%2C-23.429361%2C-23.428249%2C-23.420726%2C-23.419049%2C-23.41933%2C-23.417654%2C-23.423797%2C-23.422121%2C-23.422402%2C-23.414301%2C-23.412625%2C-23.412906%2C-23.411229%2C-23.417373%2C-23.415696%2C-23.415978%2C-23.419611%2C-23.417935%2C-23.418216%2C-23.41654%2C-23.422683%2C-23.421007%2C-23.421287%2C-23.413187%2C-23.41151%2C-23.411791%2C-23.410115%2C-23.416259%2C-23.414582%2C-23.414863%2C-23.428264%2C-23.426588%2C-23.426869%2C-23.425192%2C-23.431335%2C-23.429659%2C-23.42994%2C-23.42184%2C-23.420163%2C-23.420445%2C-23.418768%2C-23.424911%2C-23.423235%2C-23.423516%2C-23.42715%2C-23.425474%2C-23.425754%2C-23.424078%2C-23.430221%2C-23.428545%2C-23.428826%2C-23.401183%2C-23.399507%2C-23.39811%2C-23.404255%2C-23.402579%2C-23.402859%2C-23.394758%2C-23.393082%2C-23.393361%2C-23.391685%2C-23.397831%2C-23.396155%2C-23.396434%2C-23.393641%2C-23.391965%2C-23.392244%2C-23.390568%2C-23.396713%2C-23.395037%2C-23.408724%2C-23.407048%2C-23.407328%2C-23.405652%2C-23.411796%2C-23.41012%2C-23.4104%2C-23.4023%2C-23.400624%2C-23.400903%2C-23.399227%2C-23.405372%2C-23.403696%2C-23.403976%2C-23.405931%2C-23.409003%2C-23.389449%2C-23.387773%2C-23.388053%2C-23.386376%2C-23.392522%2C-23.390846%2C-23.391126%2C-23.383023%2C-23.381627%2C-23.386096%2C-23.38442%2C-23.3847%2C-23.388333&longitude=-46.616318%2C-46.649707%2C-46.640494%2C-46.603552%2C-46.606563%2C-46.60045%2C-46.603461%2C-46.603642%2C-46.606653%2C-46.600541%2C-46.609483%2C-46.612494%2C-46.606382%2C-46.609393%2C-46.609573%2C-46.612584%2C-46.606472%2C-46.594338%2C-46.597349%2C-46.591237%2C-46.594248%2C-46.594428%2C-46.597439%2C-46.591327%2C-46.60027%2C-46.603281%2C-46.597169%2C-46.60018%2C-46.60036%2C-46.603371%2C-46.597259%2C-46.606833%2C-46.609844%2C-46.603732%2C-46.606743%2C-46.606924%2C-46.609935%2C-46.603822%2C-46.612765%2C-46.615776%2C-46.609664%2C-46.612675%2C-46.612855%2C-46.615866%2C-46.609754%2C-46.59762%2C-46.600631%2C-46.594519%2C-46.59753%2C-46.59771%2C-46.600721%2C-46.594609%2C-46.560133%2C-46.563145%2C-46.560043%2C-46.560223%2C-46.563235%2C-46.557122%2C-46.566066%2C-46.569077%2C-46.562965%2C-46.565976%2C-46.566156%2C-46.569167%2C-46.563055%2C-46.556852%2C-46.559863%2C-46.553751%2C-46.556762%2C-46.556942%2C-46.559953%2C-46.563415%2C-46.566426%2C-46.560314%2C-46.563325%2C-46.563505%2C-46.566516%2C-46.560404%2C-46.569347%2C-46.572359%2C-46.566246%2C-46.569257%2C-46.569438%2C-46.572449%2C-46.566336%2C-46.557212%2C-46.557302%2C-46.581212%2C-46.584223%2C-46.578111%2C-46.581122%2C-46.581302%2C-46.584313%2C-46.578201%2C-46.587144%2C-46.584043%2C-46.587234%2C-46.590245%2C-46.584133%2C-46.571998'
For more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429

## Sondagem de fontes externas

### GeoSampa — WFS (capabilities)

- `https://wfs.geosampa.prefeitura.sp.gov.br/geoserver/ows?service=WFS&request=GetCapabilities` → HTTP 200, 420478 bytes, `application/xml`
  - 485 camadas; relacionadas a água/risco: `geoportal:risco_ocorrencia_alagamento`, `geoportal:bacia_hidrografica`, `geoportal:caderno_drenagem`, `geoportal:risco_ocorrencia_deslizamento`, `geoportal:diagnostico_socioambiental_-_riscos`, `geoportal:drenagem`, `geoportal:hidrografia_ilha`, `geoportal:intervencao_caderno_drenagem`, `geoportal:risco_ocorrencia_inundacao`, `geoportal:sac_limpeza_enchente_evento`, `geoportal:mancha_inundacao_100`, `geoportal:mancha_inundacao_25`, `geoportal:mancha_inundacao_5`, `geoportal:hidrografia_restituida`, `geoportal:obra_drenagem_planejada`, `geoportal:area_inundavel`, `geoportal:plano_diretor_drenagem`, `geoportal:risco_ocorrencia_queda_arvore`, `geoportal:reservatorio_amortecimento`, `geoportal:area_risco_geologico`, `geoportal:risco_hidrologico`, `geoportal:risco_ocorrencia_risco_deslizamento`, `geoportal:pde_drenagem_acao_prioritaria_linear`, `geoportal:pde_drenagem_acao_prioritaria_pontual`, `geoportal:sac_sugestao_obra_drenagem_corrego`

### GeoSampa — portal

- `https://geosampa.prefeitura.sp.gov.br/PaginasPublicas/_SBC.aspx` → HTTP 200, 50033 bytes, `text/html`

### CGE — alagamentos

- `https://www.cgesp.org/v3/alagamentos.jsp` → HTTP 200, 11925 bytes, `text/html;charset=UTF-8`

### RainViewer — API

- `https://api.rainviewer.com/public/weather-maps.json` → HTTP 200, 818 bytes, `application/json`
  - host `https://tilecache.rainviewer.com`; 13 quadros de radar recentes

### RainViewer — termos da API

- `https://www.rainviewer.com/api.html` → HTTP 200, 36060 bytes, `text/html`
  - trecho: “Terms of Use”
  - trecho: “Attribution is mandatory under the free terms of use and helps us continue offering the API at no cost”
  - trecho: “Attribution is mandatory under the free terms of use and helps us continue offering the API at no cost”

