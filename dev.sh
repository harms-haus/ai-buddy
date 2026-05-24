#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  Kids Agent Dev Launcher
#  Starts all 3 services with color-coded, prefixed logs.
#  Usage:  ./dev.sh          (start/restart)
#          ./dev.sh --stop   (kill only, don't restart)
# ──────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

# ── Colors ────────────────────────────────────────────────
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BLUE=$'\033[34m'
MAGENTA=$'\033[35m'
CYAN=$'\033[36m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

# ── Service definitions ───────────────────────────────────
AGENT_PORT=4111
TTS_PORT=10201
STT_PORT=10200

AGENT_COLOR="$CYAN"
TTS_COLOR="$GREEN"
STT_COLOR="$MAGENTA"
SYS_COLOR="$YELLOW"

PIDS_FILE="$ROOT/.dev-pids"
LOG_DIR="$ROOT/.dev-logs"

# ── Helpers ───────────────────────────────────────────────
log()    { printf "${SYS_COLOR}${BOLD}[dev]${RESET} %s\n" "$*"; }
log_ok() { printf "${SYS_COLOR}${BOLD}[dev]${RESET} ${GREEN}✓${RESET} %s\n" "$*"; }
log_err(){ printf "${RED}${BOLD}[dev] ✗${RESET} %s\n" "$*" >&2; }

check_port() {
    local port=$1
    if command -v ss &>/dev/null; then
        ss -tlnp 2>/dev/null | grep -q ":${port} " 
    elif command -v lsof &>/dev/null; then
        lsof -ti :"$port" &>/dev/null
    fi
}

kill_port() {
    local port=$1 label=$2
    if check_port "$port"; then
        log "Stopping $label (port $port)..."
        # Try graceful first
        local pids
        pids=$(lsof -ti :"$port" 2>/dev/null || true)
        if [[ -n "$pids" ]]; then
            kill $pids 2>/dev/null || true
            sleep 0.5
            # Force kill anything still alive
            pids=$(lsof -ti :"$port" 2>/dev/null || true)
            [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
        fi
        log_ok "$label stopped"
    fi
}

wait_for_port() {
    local port=$1 label=$2 timeout=${3:-30}
    local elapsed=0
    while ! check_port "$port"; do
        sleep 0.5
        elapsed=$((elapsed + 1))
        if (( elapsed >= timeout * 2 )); then
            log_err "$label did not start within ${timeout}s"
            return 1
        fi
    done
}

# ── Cleanup on exit ──────────────────────────────────────
cleanup() {
    log "Shutting down..."
    if [[ -f "$PIDS_FILE" ]]; then
        while IFS= read -r pid; do
            [[ -n "$pid" ]] && kill "$pid" 2>/dev/null || true
        done < "$PIDS_FILE"
        rm -f "$PIDS_FILE"
    fi
    kill_port "$AGENT_PORT" "agent"
    kill_port "$TTS_PORT"   "tts"
    kill_port "$STT_PORT"   "stt"
    # Clean up log pipes
    [[ -d "$LOG_DIR" ]] && rm -rf "$LOG_DIR"
    log_ok "All services stopped"
    exit 0
}
trap cleanup EXIT INT TERM

# ── Stop existing services ───────────────────────────────
log "Stopping any existing services..."
kill_port "$AGENT_PORT" "agent"
kill_port "$TTS_PORT"   "tts"
kill_port "$STT_PORT"   "stt"
sleep 0.5

# ── Handle --stop flag ───────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
    log_ok "Stopped all services (--stop)"
    exit 0
fi

# ── Prepare log directory ────────────────────────────────
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# ── Prefix logger ────────────────────────────────────────
# Reads stdin, prepends color-coded tag, relays to stdout
prefix_pipe() {
    local color=$1 label=$2 pipe=$3
    tail -f "$pipe" | while IFS= read -r line; do
        printf "${color}${BOLD}[${label}]${RESET} %s\n" "$line"
    done &
    echo $! >> "$PIDS_FILE"
}

# ══════════════════════════════════════════════════════════
#  1. BUILD AGENT
# ══════════════════════════════════════════════════════════
log "Building agent..."
(
    cd "$ROOT/agent"
    if ! npm run build 2>&1; then
        log_err "Agent build failed!"
        exit 1
    fi
)
log_ok "Agent built"

# ══════════════════════════════════════════════════════════
#  2. START AGENT (Mastra)
# ══════════════════════════════════════════════════════════
log "Starting agent on :$AGENT_PORT..."
(
    cd "$ROOT/agent"
    npm run start 2>&1
) > "$LOG_DIR/agent.pipe" 2>&1 &
echo $! >> "$PIDS_FILE"
prefix_pipe "$AGENT_COLOR" "agent" "$LOG_DIR/agent.pipe" &

# ══════════════════════════════════════════════════════════
#  3. START TTS (Kokoro)
# ══════════════════════════════════════════════════════════
log "Starting TTS on :$TTS_PORT..."
(
    cd "$ROOT/tts"
    source venv/bin/activate
    PYTHONUNBUFFERED=1 python server.py 2>&1
) > "$LOG_DIR/tts.pipe" 2>&1 &
echo $! >> "$PIDS_FILE"
prefix_pipe "$TTS_COLOR" " tts " "$LOG_DIR/tts.pipe" &

# ══════════════════════════════════════════════════════════
#  4. START STT (Whisper)
# ══════════════════════════════════════════════════════════
log "Starting STT on :$STT_PORT..."
(
    cd "$ROOT/stt"
    source venv/bin/activate
    PYTHONUNBUFFERED=1 python server.py 2>&1
) > "$LOG_DIR/stt.pipe" 2>&1 &
echo $! >> "$PIDS_FILE"
prefix_pipe "$STT_COLOR" " stt " "$LOG_DIR/stt.pipe" &

# ══════════════════════════════════════════════════════════
#  5. WAIT FOR READY
# ══════════════════════════════════════════════════════════
echo ""
log "Waiting for services to become ready..."

FAIL=0
if wait_for_port "$TTS_PORT" "TTS" 30; then
    log_ok "TTS ready"
else
    log_err "TTS failed to start"
    FAIL=1
fi

if wait_for_port "$STT_PORT" "STT" 60; then
    log_ok "STT ready"
else
    log_err "STT failed to start"
    FAIL=1
fi

if wait_for_port "$AGENT_PORT" "Agent" 30; then
    log_ok "Agent ready"
else
    log_err "Agent failed to start"
    FAIL=1
fi

# ══════════════════════════════════════════════════════════
#  6. STATUS BANNER
# ══════════════════════════════════════════════════════════
echo ""
if [[ $FAIL -eq 0 ]]; then
    printf "${GREEN}${BOLD}  ✦ All services running ✦${RESET}\n"
else
    printf "${RED}${BOLD}  ✦ Some services failed — check logs above ✦${RESET}\n"
fi
echo ""
printf "  ${DIM}Agent${RESET}  http://localhost:${AGENT_PORT}  ${AGENT_COLOR}●${RESET}\n"
printf "  ${DIM}TTS${RESET}    http://localhost:${TTS_PORT}    ${GREEN}●${RESET}\n"
printf "  ${DIM}STT${RESET}    http://localhost:${STT_PORT}    ${MAGENTA}●${RESET}\n"
echo ""
printf "  ${DIM}Press Ctrl+C to stop all services${RESET}\n"
echo ""

# ── Keep script alive ────────────────────────────────────
wait
