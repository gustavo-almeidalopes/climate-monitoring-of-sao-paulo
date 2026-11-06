#!/usr/bin/env bash
# Sobe o backend (com recarga de código) e abre o ClimaSP no Safari de um iPhone no Simulador iOS.
# Uso: scripts/ios/run.sh [--watch]   (--watch recarrega a página a cada alteração de arquivo)
source "$(dirname "$0")/common.sh"
require_macos
require_xcode
[ -x "$VENV/bin/python" ] || die "Ambiente não configurado. Rode: scripts/ios/setup.sh"

# Credenciais de desenvolvimento para os perfis de operação (geradas uma vez, fora do git).
ENV_DEV="$ROOT/.env.dev"
if [ ! -f "$ENV_DEV" ]; then
    {
        echo "OPERATOR_TOKEN=op-$(openssl rand -hex 8)"
        echo "MANAGER_TOKEN=gestor-$(openssl rand -hex 8)"
    } > "$ENV_DEV"
    chmod 600 "$ENV_DEV"
fi
set -a; . "$ENV_DEV"; set +a
export DEV_CLIENT_LOG=true ENVIRONMENT=development

echo "== Front-end (TypeScript)"
if command -v npm >/dev/null 2>&1; then
    (cd "$ROOT" && { [ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null; } && npm run --silent build) \
        && ok "src/*.ts compilado para js/" || die "Falha ao compilar o TypeScript (rode: npm run build)."
else
    warn "npm ausente: usando o js/ já versionado (instale Node para editar src/*.ts)."
fi

echo "== Backend"
if server_running; then
    ok "Servidor já está no ar em http://localhost:${PORT}"
else
    (cd "$ROOT" && nohup "$VENV/bin/python" -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" \
        --reload --reload-dir app --reload-include '*.py' > "$LOG_DIR/server.log" 2>&1 & echo $! > "$LOG_DIR/server.pid")
    for _ in $(seq 1 60); do server_running && break; sleep 1; done
    server_running || { tail -30 "$LOG_DIR/server.log"; die "O servidor não subiu (log acima: logs/server.log)."; }
    ok "Servidor no ar em http://localhost:${PORT} (log: logs/server.log)"
fi

echo "== Simulador"
UDID="$(pick_device)"
[ -n "$UDID" ] || die "Nenhum iPhone disponível. Rode: scripts/ios/setup.sh"
echo "$UDID" > "$STATE_FILE"
STATE="$(xcrun simctl list devices | grep "$UDID" | grep -o '(Booted)' || true)"
[ -n "$STATE" ] || xcrun simctl boot "$UDID"
open -a Simulator --args -CurrentDeviceUDID "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
ok "$(xcrun simctl list devices | grep "$UDID" | sed 's/^ *//')"
xcrun simctl openurl "$UDID" "$APP_URL"
ok "Aberto no Safari: $APP_URL"
info "Operação: abra ${APP_URL}&operador=1 e entre com OPERATOR_TOKEN de .env.dev"

if [ "${1:-}" = "--watch" ]; then
    exec "$IOS_DIR/watch.sh"
fi
