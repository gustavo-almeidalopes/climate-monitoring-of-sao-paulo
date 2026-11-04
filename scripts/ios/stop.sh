#!/usr/bin/env bash
# Para o servidor e desliga o simulador. Uso: scripts/ios/stop.sh [--keep-sim]
source "$(dirname "$0")/common.sh"
if [ -f "$LOG_DIR/server.pid" ]; then
    kill "$(cat "$LOG_DIR/server.pid")" 2>/dev/null && ok "Servidor parado." || info "Servidor já estava parado."
    rm -f "$LOG_DIR/server.pid"
fi
if [ "${1:-}" != "--keep-sim" ] && [ "$(uname -s)" = "Darwin" ]; then
    UDID="$(pick_device)"
    [ -n "$UDID" ] && xcrun simctl shutdown "$UDID" 2>/dev/null && ok "Simulador desligado."
fi
