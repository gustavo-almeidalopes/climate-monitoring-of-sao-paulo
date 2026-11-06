#!/usr/bin/env bash
# Recarga automática: a cada alteração no front-end, recarrega a página no simulador.
# (O backend já recarrega sozinho com uvicorn --reload; o TypeScript é recompilado com tsc --watch.)
# Ctrl+C encerra.
source "$(dirname "$0")/common.sh"
require_macos
command -v fswatch >/dev/null 2>&1 || die "fswatch ausente: brew install fswatch"
if command -v npm >/dev/null 2>&1; then
    (cd "$ROOT" && npm run --silent watch > "$LOG_DIR/tsc.log" 2>&1 &) && info "tsc --watch: src/*.ts -> js/ (log: logs/tsc.log)"
fi
ok "Observando index.html, styles.css, config.js, js/ e data/… (Ctrl+C para sair)"
fswatch -o -l 0.4 "$ROOT/index.html" "$ROOT/styles.css" "$ROOT/config.js" "$ROOT/js" "$ROOT/data" | while read -r _; do
    "$IOS_DIR/reload.sh" >/dev/null && info "$(date +%H:%M:%S) recarregado"
done
