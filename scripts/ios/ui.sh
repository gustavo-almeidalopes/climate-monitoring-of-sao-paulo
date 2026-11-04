#!/usr/bin/env bash
# Interação com o app no simulador via idb (coordenadas em pontos da tela do iPhone).
#   scripts/ios/ui.sh tree                  árvore de acessibilidade (rótulos e posições) em JSON
#   scripts/ios/ui.sh tap X Y               toque
#   scripts/ios/ui.sh type "texto"          digita (teclado americano; para acentos use o MCP: ui_type method=paste)
#   scripts/ios/ui.sh swipe X1 Y1 X2 Y2     arrasto
#   scripts/ios/ui.sh key ENTER|DELETE      tecla
#   scripts/ios/ui.sh open URL              abre uma URL no Safari
source "$(dirname "$0")/common.sh"
require_macos
command -v idb >/dev/null 2>&1 || die "idb ausente. Rode: scripts/ios/setup.sh"
UDID="$(pick_device)"
[ -n "$UDID" ] || die "Nenhum simulador ligado. Rode: scripts/ios/run.sh"
cmd="${1:-}"; shift || true
case "$cmd" in
    tree)  idb ui describe-all --udid "$UDID" --json ;;
    tap)   idb ui tap --udid "$UDID" "$1" "$2" ;;
    type)  idb ui text --udid "$UDID" "$1" ;;
    swipe) idb ui swipe --udid "$UDID" "$1" "$2" "$3" "$4" ;;
    key)   case "$1" in ENTER) idb ui key --udid "$UDID" 40 ;; DELETE) idb ui key --udid "$UDID" 42 ;; *) idb ui key --udid "$UDID" "$1" ;; esac ;;
    open)  xcrun simctl openurl "$UDID" "$1" ;;
    *)     sed -n '2,9p' "$0"; exit 1 ;;
esac
