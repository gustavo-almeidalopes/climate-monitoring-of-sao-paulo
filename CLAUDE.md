# ClimaSP — guia para o Claude Code

Painel de risco de alagamento da Zona Norte de São Paulo. Backend FastAPI em `app/`; front-end
web estático (`index.html`, `styles.css`, `config.js`) com código em **TypeScript** (`src/*.ts`)
compilado pelo `tsc` para módulos ES em `js/` (versionado; `npm run build`). Edite sempre `src/`,
nunca `js/`. Interface em português do Brasil. Preserve a arquitetura: estado central em
`src/store.ts` + `src/state.ts`, cada módulo assina o que exibe; critério único de nível em
`app/core/risk_levels.py` espelhado em `src/risk.ts`.

## Regras do projeto
- Não inventar dados geográficos ou de equipes: fonte real verificada (registrar em
  `data/geo/metadata.json`/README) ou dado de exemplo explicitamente rotulado como fictício.
- Mudanças de API são aditivas; não quebrar endpoints existentes.
- Acessibilidade WCAG 2.1 AA nos dois temas; nunca depender só de cor: o nível aparece sempre por escrito
  (Baixo/Médio/Alto/Crítico) ao lado do ponto colorido. Sem emojis nem glifos Unicode como ícone
  (triângulos de alerta, setas, marcas de seleção, bolinhas); ícones são SVG do sprite em `index.html`, no traço do SF Symbols.
- Estilo Apple (HIG): fonte do sistema (SF), azul do sistema como destaque, materiais translúcidos,
  controle segmentado, interruptores e controles deslizantes do iOS. Tokens em `styles.css`.
- Funcionar em 360 px sem rolagem horizontal.

## Fluxo de trabalho com o Simulador iOS (no Mac)
O app roda no Safari de um iPhone no Simulador iOS. Para cada alteração:

1. **Implementar** a alteração.
2. **Executar**: `scripts/ios/run.sh` (sobe o backend com recarga e abre o app no simulador).
   Com `scripts/ios/watch.sh` rodando, o front recarrega sozinho a cada arquivo salvo;
   senão, `scripts/ios/reload.sh`.
3. **Inspecionar visualmente**: `scripts/ios/shot.sh <nome>` e ler o PNG impresso, ou a ferramenta
   `screenshot`/`ui_view` do MCP `ios-simulator`.
4. **Testar os comportamentos afetados** no próprio simulador: `ui_describe_all` para achar
   elementos e coordenadas, `ui_tap`, `ui_type` (use `method: "paste"` para texto com acento),
   `ui_swipe` — ou `scripts/ios/ui.sh tree|tap|type|swipe`.
5. **Consultar logs**: `scripts/ios/logs.sh` (servidor + erros do navegador em `logs/client.log`),
   `scripts/ios/logs.sh --safari 20` (log do WebKit no simulador).
6. **Corrigir** o que aparecer e repetir; antes de concluir, `scripts/ios/test.sh`
   (pytest + Playwright, incluindo iPhone WebKit) para regressões.

Primeira vez no Mac: `scripts/ios/doctor.sh` (diagnóstico), depois `scripts/ios/setup.sh` (instala só o
que falta) e `scripts/ios/run.sh`. Credenciais de operação de desenvolvimento ficam em `.env.dev`
(gerado pelo `run.sh`, fora do git); abra `http://localhost:8000/?dev=1&operador=1`.

## Comandos úteis
- Backend: `uvicorn app.main:app --reload --port 8000`
- Testes: `pytest -q` · `cd e2e && npx playwright test --grep-invert @screenshot`
- Capturas para PR: `cd e2e && SHOT_DIR=<pasta> SHOT_PREFIX=depois npx playwright test --grep @screenshot`
