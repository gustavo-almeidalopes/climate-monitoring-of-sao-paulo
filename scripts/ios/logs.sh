#!/usr/bin/env bash
# Logs para diagnóstico:
#   scripts/ios/logs.sh            últimas linhas do servidor e dos erros do navegador (logs/client.log)
#   scripts/ios/logs.sh --follow   acompanha os dois ao vivo
#   scripts/ios/logs.sh --safari [segundos]   log do Safari/WebKit no simulador (padrão: 20 s)
source "$(dirname "$0")/common.sh"
touch "$LOG_DIR/server.log" "$LOG_DIR/client.log"
case "${1:-}" in
    --follow) tail -n 40 -f "$LOG_DIR/server.log" "$LOG_DIR/client.log" ;;
    --safari)
        require_macos
        UDID="$(pick_device)"
        SECS="${2:-20}"
        info "Log do Safari/WebKit por ${SECS}s…"
        xcrun simctl spawn "$UDID" log stream --style compact --level debug \
            --predicate 'process == "MobileSafari" OR process CONTAINS "WebKit"' &
        PID=$!; sleep "$SECS"; kill "$PID" 2>/dev/null ;;
    *)
        echo "== logs/server.log (últimas 40)"; tail -n 40 "$LOG_DIR/server.log"
        echo; echo "== logs/client.log — erros do navegador (últimas 40)"; tail -n 40 "$LOG_DIR/client.log" ;;
esac
