/*
 * Desenvolvimento: encaminha erros do navegador ao servidor (POST /api/v1/dev/client-log),
 * que grava em logs/client.log. Serve para ler erros do Safari do Simulador iOS (ou de um
 * celular na mesma rede) sem abrir o Web Inspector. Só liga com window.CLIMASP_DEV_LOG = true
 * (config.js ou scripts/ios/run.sh) e o servidor só aceita com DEV_CLIENT_LOG=true.
 */
import { sendClientLog } from "./api.js";
export function initDevLog() {
    if (window.CLIMASP_DEV_LOG !== true)
        return;
    const send = (level, message, source = "") => sendClientLog({ level, message: String(message).slice(0, 4000), source: String(source).slice(0, 300), url: location.href.slice(0, 300) });
    window.addEventListener("error", e => send("error", e.message, `${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`));
    window.addEventListener("unhandledrejection", e => send("error", `Promise rejeitada: ${e.reason && (e.reason.stack || e.reason.message || e.reason)}`));
    for (const level of ["error", "warn"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            send(level, args.map(a => (a instanceof Error ? a.stack || a.message : typeof a === "object" ? safeJson(a) : String(a))).join(" "));
        };
    }
    send("info", `devlog ativo · ${navigator.userAgent}`);
}
function safeJson(v) {
    try {
        return JSON.stringify(v);
    }
    catch (_) {
        return String(v);
    }
}
