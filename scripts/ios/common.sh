#!/usr/bin/env bash
# Funções compartilhadas pelos scripts do Simulador iOS (compatível com o bash 3.2 do macOS).
# Uso: source "$(dirname "$0")/common.sh"

set -u

IOS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$IOS_DIR/../.." && pwd)"
LOG_DIR="$ROOT/logs"
SHOT_DIR="$LOG_DIR/ios"
VENV="$ROOT/.venv"
PORT="${CLIMASP_PORT:-8000}"
APP_URL="http://localhost:${PORT}/?dev=1"
STATE_FILE="$LOG_DIR/ios-device"   # UDID do simulador em uso
mkdir -p "$LOG_DIR" "$SHOT_DIR"

if [ -t 1 ]; then
    C_OK=$'\033[32m'; C_WARN=$'\033[33m'; C_FAIL=$'\033[31m'; C_DIM=$'\033[2m'; C_END=$'\033[0m'
else
    C_OK=""; C_WARN=""; C_FAIL=""; C_DIM=""; C_END=""
fi

ok()   { printf '%s✓%s %s\n' "$C_OK" "$C_END" "$*"; }
warn() { printf '%s!%s %s\n' "$C_WARN" "$C_END" "$*"; }
fail() { printf '%s✗%s %s\n' "$C_FAIL" "$C_END" "$*"; }
info() { printf '%s·%s %s\n' "$C_DIM" "$C_END" "$*"; }
die()  { fail "$*"; exit 1; }

require_macos() {
    [ "$(uname -s)" = "Darwin" ] || die "O Simulador iOS só existe no macOS (este sistema é $(uname -s)). Rode estes scripts no seu Mac."
}

require_xcode() {
    xcrun --find simctl >/dev/null 2>&1 || die "simctl não encontrado. Rode: scripts/ios/doctor.sh (precisa do Xcode completo, não só das Command Line Tools)."
}

# Python ≥ 3.10 (o código usa a sintaxe "str | None" em tempo de execução).
find_python() {
    for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
        if command -v "$candidate" >/dev/null 2>&1; then
            if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
                command -v "$candidate"
                return 0
            fi
        fi
    done
    return 1
}

# UDID do simulador: o salvo em logs/ios-device, o já ligado, ou o melhor iPhone disponível.
# Preferência: $IOS_DEVICE (nome exato), depois o iPhone mais novo do runtime iOS mais recente.
pick_device() {
    if [ -f "$STATE_FILE" ]; then
        local saved
        saved="$(cat "$STATE_FILE")"
        if xcrun simctl list devices available | grep -q "$saved"; then
            echo "$saved"
            return 0
        fi
    fi
    xcrun simctl list devices available -j | IOS_DEVICE="${IOS_DEVICE:-}" python3 -c '
import json, os, re, sys
data = json.load(sys.stdin)["devices"]
wanted = os.environ.get("IOS_DEVICE", "")
def ver(runtime):
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
best = None
for runtime, devices in data.items():
    if "iOS" not in runtime:
        continue
    for d in devices:
        if not d.get("isAvailable", True) or not d["name"].startswith("iPhone"):
            continue
        if wanted and d["name"] != wanted:
            continue
        booted = d.get("state") == "Booted"
        num = re.search(r"iPhone (\d+)", d["name"])
        plain = d["name"] == f"iPhone {num.group(1)}" if num else False
        key = (booted, ver(runtime), int(num.group(1)) if num else 0, plain)
        if best is None or key > best[0]:
            best = (key, d["udid"])
print(best[1] if best else "")
'
}

server_running() {
    curl -fsS -o /dev/null --max-time 2 "http://localhost:${PORT}/api/v1/weather/thresholds"
}
