#!/usr/bin/env bash
# Recarrega o ClimaSP no Safari do simulador (reabre a URL). Uso: scripts/ios/reload.sh [url]
source "$(dirname "$0")/common.sh"
require_macos
UDID="$(pick_device)"
[ -n "$UDID" ] || die "Nenhum simulador. Rode: scripts/ios/run.sh"
xcrun simctl openurl "$UDID" "${1:-$APP_URL}"
ok "Recarregado: ${1:-$APP_URL}"
