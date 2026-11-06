/* Gaveta de notícias de alagamento (RSS coletado pelo backend). */
import { api } from "./api.js";
import { icon } from "./icons.js";
import { $, $$, escapeHtml, stripEmoji, timeAgo } from "./util.js";
const PAGE = 15;
let articles = [];
let activeTab = "all";
let renderLimit = PAGE;
const SKELETON = Array.from({ length: 3 }, () => '<div class="skeleton-card" aria-hidden="true"><div class="skeleton-line w55 h8"></div>' +
    '<div class="skeleton-line w90 h12" style="margin-top:8px"></div><div class="skeleton-line w75 h12"></div>' +
    '<div class="skeleton-line w40 h8" style="margin-top:6px"></div></div>').join("");
const relevanceClass = score => (score >= 6 ? "high" : score >= 3 ? "medium" : "low");
const relevanceLabel = score => (score >= 6 ? "Alta relevância" : score >= 3 ? "Média relevância" : "Baixa");
function card(a) {
    const rc = relevanceClass(a.relevance_score);
    const raw = stripEmoji(a.summary);
    const summary = raw ? escapeHtml(raw.slice(0, 120)) + (raw.length > 120 ? "…" : "") : "";
    const url = /^https?:\/\//i.test(a.url || "") ? a.url : "#";
    return `<a class="news-card rel-${rc}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        <div class="news-source-row"><span class="news-source-dot"></span><span class="news-source">${escapeHtml(stripEmoji(a.source))}</span></div>
        <div class="news-title">${escapeHtml(stripEmoji(a.title))}</div>
        ${summary ? `<div class="news-summary">${summary}</div>` : ""}
        <div class="news-footer-row"><span class="news-time">${timeAgo(a.published_at || a.scraped_at)}</span>
        <span class="news-pill ${rc}">${relevanceLabel(a.relevance_score)}</span>
        ${icon("external-link", "news-ext")}<span class="sr-only">(abre em nova aba)</span></div>
    </a>`;
}
function emptyState() {
    const filtering = activeTab === "high" && articles.length > 0;
    return `<div class="news-empty">
        <div class="news-empty-icon">${icon(filtering ? "search" : "radio")}</div>
        <div class="news-empty-text">${filtering ? "Nenhuma correspondência" : "Nenhuma notícia recente"}</div>
        <div class="news-empty-sub">${filtering
        ? "Nenhuma das notícias carregadas tem alta relevância. Veja todas ou busque de novo nas fontes."
        : "Não encontramos notícias de alagamento nas últimas 72 horas nas fontes monitoradas."}</div>
        <button type="button" class="empty-action" id="newsEmptyAction" data-action="${filtering ? "clear" : "scrape"}">
            ${icon(filtering ? "x" : "refresh")} ${filtering ? "Ver todas as notícias" : "Buscar agora"}</button>
    </div>`;
}
function render() {
    const list = $("#newsList");
    const badge = $("#newsBadge");
    const filtered = activeTab === "high" ? articles.filter(a => a.relevance_score >= 6) : articles;
    const highCount = articles.filter(a => a.relevance_score >= 6).length;
    badge.textContent = String(articles.length);
    badge.hidden = !articles.length;
    $("#btnNews").classList.toggle("has-notif", highCount > 0);
    if (!filtered.length) {
        list.innerHTML = emptyState();
        $("#newsEmptyAction").addEventListener("click", e => {
            if (e.currentTarget.dataset.action === "clear")
                setTab("all");
            else
                scrape();
        });
        return;
    }
    // Renderiza em páginas: a gaveta mantém poucas dezenas de nós.
    const visible = filtered.slice(0, renderLimit);
    const remaining = filtered.length - visible.length;
    const scroll = list.scrollTop;
    list.innerHTML = visible.map(card).join("") +
        (remaining ? `<button type="button" class="news-more" id="newsMore">Carregar mais (${remaining})</button>` : "");
    list.scrollTop = scroll;
    const more = $("#newsMore");
    if (more)
        more.addEventListener("click", () => { renderLimit += PAGE; render(); });
}
function setTab(tab) {
    activeTab = tab;
    renderLimit = PAGE;
    $("#newsList").scrollTop = 0;
    $$(".news-tab").forEach(t => {
        const on = t.dataset.tab === tab;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", String(on));
    });
    render();
}
export async function loadNews() {
    const list = $("#newsList");
    const status = $("#newsStatus");
    list.innerHTML = SKELETON;
    renderLimit = PAGE;
    status.textContent = "Buscando notícias… lendo as fontes monitoradas";
    status.className = "news-status";
    try {
        const data = await api.news();
        articles = Array.isArray(data.articles) ? data.articles : [];
        render();
        status.textContent = data.last_scraped_at
            ? `Atualizado ${timeAgo(data.last_scraped_at)} · G1 SP · Folha · UOL`
            : "Fontes: G1 SP · Folha de SP · UOL";
        status.className = data.last_scraped_at ? "news-status fresh" : "news-status";
    }
    catch (err) {
        console.warn("Erro ao carregar notícias:", err);
        list.innerHTML = `<div class="news-empty"><div class="news-empty-icon">${icon("alert-triangle")}</div>
            <div class="news-empty-text">Não foi possível carregar</div>
            <div class="news-empty-sub">A API de notícias não respondeu. Verifique sua conexão e tente novamente.</div>
            <button type="button" class="empty-action" id="newsEmptyAction">${icon("refresh")} Tentar novamente</button></div>`;
        $("#newsEmptyAction").addEventListener("click", loadNews);
        status.textContent = "Fontes indisponíveis no momento";
        status.className = "news-status";
    }
}
async function scrape() {
    const btn = $("#newsScrapeBtn");
    btn.classList.add("spinning");
    btn.disabled = true;
    try {
        await api.scrapeNews();
    }
    catch (err) {
        console.warn("Erro ao coletar notícias:", err);
    }
    finally {
        btn.classList.remove("spinning");
        btn.disabled = false;
    }
    await loadNews();
}
function initSwipe(setOpen) {
    // Só acompanha gestos que começam dentro da gaveta aberta (fechar) ou na
    // borda direita da tela (abrir), para nunca sequestrar o arrastar do mapa.
    const panel = $("#newsPanel");
    const isOverlay = () => window.matchMedia("(max-width: 900px)").matches;
    let startX = 0, startY = 0, tracking = false, fromPanel = false;
    document.addEventListener("touchstart", e => {
        tracking = false;
        if (!isOverlay() || e.touches.length !== 1)
            return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        const open = !panel.classList.contains("collapsed");
        fromPanel = open && panel.contains(e.target);
        tracking = fromPanel || (!open && startX >= window.innerWidth - 28);
    }, { passive: true });
    document.addEventListener("touchend", e => {
        if (!tracking)
            return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5)
            return;
        if (dx > 0 && fromPanel)
            setOpen(false);
        else if (dx < 0 && !fromPanel)
            setOpen(true);
    }, { passive: true });
}
export function initNews() {
    const panel = $("#newsPanel");
    const btn = $("#btnNews");
    const setOpen = open => {
        panel.classList.toggle("collapsed", !open);
        panel.inert = !open;
        btn.setAttribute("aria-expanded", String(open));
        if (open)
            loadNews();
    };
    panel.inert = true;
    btn.addEventListener("click", () => setOpen(panel.classList.contains("collapsed")));
    $("#newsClose").addEventListener("click", () => { setOpen(false); btn.focus(); });
    $("#newsScrapeBtn").addEventListener("click", scrape);
    $$(".news-tab").forEach(tab => tab.addEventListener("click", () => setTab(tab.dataset.tab)));
    initSwipe(setOpen);
}
