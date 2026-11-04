#!/usr/bin/env bash
# Regressão: pytest + Playwright (Chromium desktop/celular e, no Mac, WebKit iPhone = motor do Safari).
# Uso: scripts/ios/test.sh [filtro-do-playwright]
source "$(dirname "$0")/common.sh"
[ -x "$VENV/bin/python" ] || die "Rode scripts/ios/setup.sh antes."
(cd "$ROOT" && "$VENV/bin/python" -m pytest -q) || die "pytest falhou."
ok "pytest"
cd "$ROOT/e2e" || exit 1
[ -d node_modules ] || npm ci --no-audit --no-fund
WEBKIT=0; [ "$(uname -s)" = "Darwin" ] && WEBKIT=1
E2E_WEBKIT=$WEBKIT npx playwright test --grep-invert @screenshot ${1:+-g "$1"} || die "Playwright falhou."
ok "Playwright$( [ $WEBKIT -eq 1 ] && echo ' (inclui iPhone WebKit)')"
