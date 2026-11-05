#!/usr/bin/env bash
# Diagnóstico do ambiente para rodar o ClimaSP no Simulador iOS. Só lê — não instala nada.
# Uso: scripts/ios/doctor.sh
source "$(dirname "$0")/common.sh"

PROBLEMS=0
problem() { fail "$1"; [ -n "${2:-}" ] && info "   como resolver: $2"; PROBLEMS=$((PROBLEMS + 1)); }

echo "== Sistema"
if [ "$(uname -s)" != "Darwin" ]; then
    problem "Sistema $(uname -s): o Simulador iOS só roda em macOS." "Use um Mac (Apple Silicon ou Intel) com o Xcode."
    exit 1
fi
ok "macOS $(sw_vers -productVersion) ($(sw_vers -buildVersion)) · $(uname -m)"
info "CPU: $(sysctl -n machdep.cpu.brand_string 2>/dev/null) · RAM: $(( $(sysctl -n hw.memsize) / 1073741824 )) GB"
FREE_GB=$(df -g "$ROOT" | awk 'NR==2 {print $4}')
if [ "${FREE_GB:-0}" -lt 15 ]; then
    problem "Pouco espaço livre: ${FREE_GB} GB." "Um runtime iOS ocupa ~8 GB; libere espaço antes de baixar."
else
    ok "Espaço livre: ${FREE_GB} GB"
fi

echo "== Xcode"
DEV_DIR="$(xcode-select -p 2>/dev/null || true)"
if [ -z "$DEV_DIR" ]; then
    problem "Command Line Tools não instaladas." "xcode-select --install"
else
    ok "xcode-select: $DEV_DIR"
fi
if [ -d /Applications/Xcode.app ] || ls -d /Applications/Xcode*.app >/dev/null 2>&1; then
    if xcodebuild -version >/dev/null 2>&1; then
        ok "$(xcodebuild -version | tr '\n' ' ')"
        if ! xcodebuild -license check >/dev/null 2>&1; then
            problem "Licença do Xcode não aceita." "sudo xcodebuild -license accept"
        fi
        if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
            problem "Primeira execução do Xcode pendente (componentes adicionais)." "sudo xcodebuild -runFirstLaunch"
        fi
    else
        problem "Xcode instalado, mas o xcode-select aponta para as Command Line Tools." \
            "sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
    fi
else
    problem "Xcode não instalado (o Simulador vem com ele)." "Instale pela App Store (Xcode) e abra-o uma vez."
fi

echo "== Simulador iOS"
if xcrun --find simctl >/dev/null 2>&1; then
    RUNTIMES="$(xcrun simctl list runtimes available 2>/dev/null | grep -E '^iOS' || true)"
    if [ -z "$RUNTIMES" ]; then
        problem "Nenhum runtime iOS instalado." "scripts/ios/setup.sh --runtime   (ou: xcodebuild -downloadPlatform iOS)"
    else
        echo "$RUNTIMES" | while read -r line; do ok "runtime: $line"; done
        UDID="$(pick_device)"
        if [ -n "$UDID" ]; then
            ok "iPhone escolhido: $(xcrun simctl list devices | grep "$UDID" | sed 's/^ *//')"
        else
            problem "Nenhum iPhone disponível nos runtimes instalados." "scripts/ios/setup.sh cria um."
        fi
    fi
else
    problem "simctl indisponível." "Instale o Xcode completo (ver acima)."
fi

echo "== Ferramentas do projeto"
PY="$(find_python || true)"
if [ -n "$PY" ]; then ok "Python: $("$PY" --version) ($PY)"; else problem "Python ≥ 3.10 ausente." "brew install python@3.12"; fi
if [ -x "$VENV/bin/python" ]; then
    if "$VENV/bin/python" -c "import fastapi, uvicorn, sqlalchemy" 2>/dev/null; then ok "Ambiente virtual .venv com as dependências"; else problem ".venv sem dependências." "scripts/ios/setup.sh"; fi
else
    problem "Ambiente virtual .venv não criado." "scripts/ios/setup.sh"
fi
if command -v node >/dev/null 2>&1; then
    NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
    if [ "$NODE_MAJOR" -ge 20 ]; then ok "Node $(node --version)"; else problem "Node $(node --version) é antigo (precisa ≥ 20)." "brew install node@22"; fi
else
    problem "Node.js ausente (usado pelo MCP do simulador e pelos testes)." "brew install node@22"
fi
command -v brew >/dev/null 2>&1 && ok "Homebrew $(brew --version | head -1 | awk '{print $2}')" || warn "Homebrew ausente (https://brew.sh) — só necessário para instalar idb/fswatch."

echo "== Interação com o simulador (Claude Code)"
command -v idb_companion >/dev/null 2>&1 && ok "idb_companion" || problem "idb_companion ausente (toques/digitação/árvore de acessibilidade)." "brew tap facebook/fb && brew install idb-companion"
command -v idb >/dev/null 2>&1 && ok "idb $(idb --version 2>/dev/null | head -1)" || problem "Cliente idb (fb-idb) ausente." "pipx install fb-idb   (ou: scripts/ios/setup.sh)"
command -v fswatch >/dev/null 2>&1 && ok "fswatch (recarga automática)" || warn "fswatch ausente: sem recarga automática (brew install fswatch)."
[ -f "$ROOT/.mcp.json" ] && ok ".mcp.json com o servidor ios-simulator" || warn ".mcp.json ausente."

echo "== Não necessários neste projeto"
info "CocoaPods e SDKs nativos: o ClimaSP é um app web (FastAPI + HTML/JS); roda no Safari do simulador, sem projeto Xcode."

echo
if [ "$PROBLEMS" -eq 0 ]; then ok "Ambiente pronto. Próximo passo: scripts/ios/run.sh"; else warn "$PROBLEMS pendência(s) acima. Rode scripts/ios/setup.sh e depois este diagnóstico de novo."; fi
exit "$PROBLEMS"
