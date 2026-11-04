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
