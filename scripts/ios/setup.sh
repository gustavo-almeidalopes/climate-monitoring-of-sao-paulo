#!/usr/bin/env bash
# Instala SÓ o que falta para desenvolver no Simulador iOS. Nunca atualiza o que já existe.
# Uso: scripts/ios/setup.sh [--runtime]   (--runtime baixa o runtime iOS se não houver nenhum, ~8 GB)
source "$(dirname "$0")/common.sh"
require_macos

WANT_RUNTIME=0
[ "${1:-}" = "--runtime" ] && WANT_RUNTIME=1

echo "== Xcode"
if ! xcodebuild -version >/dev/null 2>&1; then
    fail "Xcode indisponível. Passos manuais (precisam da sua senha/App Store):"
    info "1) Instale o Xcode pela App Store e abra-o uma vez."
    info "2) sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    info "3) sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch"
    info "Depois rode este script de novo."
    exit 1
fi
ok "$(xcodebuild -version | head -1)"

echo "== Runtime e iPhone no simulador"
if ! xcrun simctl list runtimes available | grep -q '^iOS'; then
    if [ "$WANT_RUNTIME" -eq 1 ]; then
        info "Baixando o runtime iOS do seu Xcode (pode levar vários minutos)…"
        xcodebuild -downloadPlatform iOS || die "Falha ao baixar o runtime iOS."
    else
        die "Nenhum runtime iOS instalado. Rode: scripts/ios/setup.sh --runtime"
    fi
fi
UDID="$(pick_device)"
if [ -z "$UDID" ]; then
    RUNTIME="$(xcrun simctl list runtimes available -j | python3 -c 'import json,sys; r=[x for x in json.load(sys.stdin)["runtimes"] if x["platform"]=="iOS"]; print(sorted(r, key=lambda x: x["version"])[-1]["identifier"])')"
    DEVTYPE="$(xcrun simctl list devicetypes -j | python3 -c 'import json,sys; t=[x for x in json.load(sys.stdin)["devicetypes"] if x["name"].startswith("iPhone")]; print(t[-1]["identifier"])')"
    UDID="$(xcrun simctl create "ClimaSP iPhone" "$DEVTYPE" "$RUNTIME")"
    ok "Criado o simulador 'ClimaSP iPhone' ($UDID)"
fi
echo "$UDID" > "$STATE_FILE"
ok "Simulador: $(xcrun simctl list devices | grep "$UDID" | sed 's/^ *//')"

echo "== Python do projeto"
PY="$(find_python || true)"
if [ -z "$PY" ]; then
    command -v brew >/dev/null 2>&1 || die "Python ≥ 3.10 ausente e sem Homebrew. Instale o Homebrew (https://brew.sh) ou o Python 3.12."
    info "Instalando python@3.12 (Homebrew)…"
    brew install python@3.12
    PY="$(find_python)" || die "Python ainda não encontrado após a instalação."
fi
if [ ! -x "$VENV/bin/python" ]; then
    "$PY" -m venv "$VENV"
    ok "Criado .venv com $("$PY" --version)"
fi
if ! "$VENV/bin/python" -c "import fastapi, uvicorn, sqlalchemy, sklearn" 2>/dev/null; then
    info "Instalando dependências do projeto em .venv…"
    "$VENV/bin/pip" install -q -r "$ROOT/requirements-dev.txt"
fi
ok "Dependências Python ok"

echo "== Interação (idb) e recarga automática"
if command -v brew >/dev/null 2>&1; then
    command -v idb_companion >/dev/null 2>&1 || { brew tap facebook/fb >/dev/null && brew install idb-companion; }
    command -v fswatch >/dev/null 2>&1 || brew install fswatch
    command -v node >/dev/null 2>&1 || brew install node@22
    command -v pipx >/dev/null 2>&1 || brew install pipx
else
    warn "Sem Homebrew: instale manualmente idb-companion, fswatch, node e pipx."
fi
if ! command -v idb >/dev/null 2>&1; then
    if command -v pipx >/dev/null 2>&1; then
        pipx install fb-idb && pipx ensurepath >/dev/null
    else
        warn "pipx ausente: cliente idb não instalado."
    fi
fi
command -v idb >/dev/null 2>&1 && ok "idb pronto" || warn "idb ainda não está no PATH (abra um novo terminal após 'pipx ensurepath')."

echo "== Testes de regressão (opcional, WebKit = motor do Safari)"
if command -v npm >/dev/null 2>&1; then
    (cd "$ROOT/e2e" && npm ci --no-audit --no-fund >/dev/null && npx playwright install webkit chromium >/dev/null) \
        && ok "Playwright + WebKit instalados (scripts/ios/test.sh)" || warn "Não foi possível preparar o Playwright."
fi

echo
ok "Configuração concluída. Próximo passo: scripts/ios/run.sh"
