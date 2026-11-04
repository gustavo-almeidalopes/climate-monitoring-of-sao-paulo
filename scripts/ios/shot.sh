#!/usr/bin/env bash
# Screenshot do simulador em logs/ios/. Imprime o caminho (o Claude Code lê o PNG).
# Uso: scripts/ios/shot.sh [nome]
source "$(dirname "$0")/common.sh"
require_macos
UDID="$(pick_device)"
[ -n "$UDID" ] || die "Nenhum simulador ligado. Rode: scripts/ios/run.sh"
FILE="$SHOT_DIR/${1:-shot}-$(date +%Y%m%d-%H%M%S).png"
xcrun simctl io "$UDID" screenshot --type=png "$FILE" >/dev/null
echo "$FILE"
