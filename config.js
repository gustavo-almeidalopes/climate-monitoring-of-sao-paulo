/*
 * Configuração do front-end estático do ClimaSP.
 *
 * CLIMASP_API_BASE: URL pública do backend FastAPI, sem barra no final
 * (ex.: "https://seu-usuario.pythonanywhere.com").
 *
 * Vazio = automático: http://localhost:8000 em desenvolvimento local e a
 * própria origem do site nos demais casos (quando o FastAPI serve o index.html).
 *
 * Na Vercel o site é só estático: sem esta URL o painel não alcança o backend
 * e mostra o banner "Sem conexão — dados de exemplo".
 */
window.CLIMASP_API_BASE = window.CLIMASP_API_BASE || "";

/*
 * CLIMASP_OSRM_URL: servidor de rotas (OSRM) para o despacho. Vazio = servidor público de
 * demonstração (router.project-osrm.org — uso moderado, sem garantia). Para operação real,
 * aponte para um OSRM próprio.
 */
window.CLIMASP_OSRM_URL = window.CLIMASP_OSRM_URL || "";

/*
 * CLIMASP_DEV_LOG: true encaminha erros do navegador ao servidor (só em desenvolvimento;
 * o servidor só aceita com DEV_CLIENT_LOG=true). Também liga com ?dev=1 na URL, que é como
 * scripts/ios/run.sh abre o app no Simulador iOS.
 */
window.CLIMASP_DEV_LOG = window.CLIMASP_DEV_LOG || /[?&]dev=1(&|$)/.test(window.location.search);
