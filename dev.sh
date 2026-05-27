#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  AI Buddy Dev Launcher
#  Starts all 3 services with color-coded, prefixed logs.
#  Usage:  ./dev.sh                    (start all services, kokoro TTS)
#          ./dev.sh --tts=chatterbox   (start with Chatterbox TTS backend)
#          ./dev.sh --tts=dia          (start with Dia TTS backend)
#          ./dev.sh --tts=chattts      (start with ChatTTS backend)
#          ./dev.sh --stop             (stop all services)
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
TTS_BACKEND="kokoro"  # default TTS backend, overridden by --tts= flag

AGENT_COLOR="$CYAN"
TTS_COLOR="$GREEN"
STT_COLOR="$MAGENTA"
SYS_COLOR="$YELLOW"

PIDS_FILE="$ROOT/.dev-pids"
LOG_DIR="$ROOT/.dev-logs"

# ── Required versions ─────────────────────────────────────
REQUIRED_NODE_MAJOR=22   # Node.js >= 22.x
PYTHON_BIN="python3"      # Python interpreter

# ── Helpers ───────────────────────────────────────────────
log()    { printf "${SYS_COLOR}${BOLD}[dev]${RESET} %s\n" "$*"; }
log_ok() { printf "${SYS_COLOR}${BOLD}[dev]${RESET} ${GREEN}✓${RESET} %s\n" "$*"; }
log_err(){ printf "${RED}${BOLD}[dev] ✗${RESET} %s\n" "$*" >&2; }

has_cuda() {
    command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null
}

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

# ══════════════════════════════════════════════════════════
#  0. PREREQUISITE CHECKS
# ══════════════════════════════════════════════════════════

# ── Stop existing services first ─────────────────────────
log "Stopping any existing services..."
kill_port "$AGENT_PORT" "agent"
kill_port "$TTS_PORT"   "tts"
kill_port "$STT_PORT"   "stt"
sleep 0.5

# ── Check / install Node.js ──────────────────────────────
if command -v node &>/dev/null; then
    NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
    if (( NODE_MAJOR >= REQUIRED_NODE_MAJOR )); then
        log_ok "Node.js $(node --version) (>= ${REQUIRED_NODE_MAJOR}.x)"
    else
        log_err "Node.js $(node --version) is too old (need >= ${REQUIRED_NODE_MAJOR}.x)"
        log "Installing Node.js ${REQUIRED_NODE_MAJOR}.x via nvm..."
        if [[ ! -d "$HOME/.nvm" ]]; then
            curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
        fi
        export NVM_DIR="$HOME/.nvm"
        source "$NVM_DIR/nvm.sh"
        nvm install "${REQUIRED_NODE_MAJOR}"
        nvm use "${REQUIRED_NODE_MAJOR}"
        log_ok "Installed Node.js $(node --version) via nvm"
    fi
else
    log_err "Node.js not found"
    log "Installing Node.js ${REQUIRED_NODE_MAJOR}.x via nvm..."
    if [[ ! -d "$HOME/.nvm" ]]; then
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
    fi
    export NVM_DIR="$HOME/.nvm"
    source "$NVM_DIR/nvm.sh"
    nvm install "${REQUIRED_NODE_MAJOR}"
    nvm use "${REQUIRED_NODE_MAJOR}"
    log_ok "Installed Node.js $(node --version) via nvm"
fi

# ── Ensure agent/data directory exists (for libsql/mastra.db) ──
mkdir -p "$ROOT/agent/data"
log_ok "agent/data/ directory ready"

# ── Check / setup TTS virtual environment ─────────────────
if [[ ! -f "$ROOT/tts/venv/bin/activate" ]]; then
    log "Creating TTS virtual environment..."
    rm -rf "$ROOT/tts/venv"
    $PYTHON_BIN -m venv "$ROOT/tts/venv"
    source "$ROOT/tts/venv/bin/activate"
    pip install --upgrade pip
    pip install -r "$ROOT/tts/requirements.txt"
    # Kokoro uses ONNX Runtime — install GPU variant when CUDA is present
    if has_cuda; then
        log "CUDA detected — installing onnxruntime-gpu for TTS..."
        pip uninstall -y onnxruntime 2>/dev/null || true
        pip install onnxruntime-gpu
        log_ok "onnxruntime-gpu installed"
    fi
    deactivate
    log_ok "TTS venv created and dependencies installed"
else
    log_ok "TTS venv exists"
    # Ensure onnxruntime-gpu is present when CUDA is available
    source "$ROOT/tts/venv/bin/activate"
    _has_gpu_rt="$($PYTHON_BIN -c 'import importlib.util; print(importlib.util.find_spec("onnxruntime-gpu") is not None)' 2>/dev/null || echo False)"
    if has_cuda && [[ "$_has_gpu_rt" == "False" ]]; then
        log "CUDA detected but onnxruntime-gpu not installed — upgrading..."
        pip uninstall -y onnxruntime 2>/dev/null || true
        pip install onnxruntime-gpu
        log_ok "onnxruntime-gpu installed"
    fi
    deactivate
fi

# ── Check / setup STT virtual environment ─────────────────
if [[ ! -f "$ROOT/stt/venv/bin/activate" ]]; then
    log "Creating STT virtual environment..."
    rm -rf "$ROOT/stt/venv"
    $PYTHON_BIN -m venv "$ROOT/stt/venv"
    source "$ROOT/stt/venv/bin/activate"
    pip install --upgrade pip
    pip install -r "$ROOT/stt/requirements.txt"
    # ctranslate2 needs nvidia-cublas-cu12 for CUDA but doesn't always pull it in
    if has_cuda; then
        log "CUDA detected — installing nvidia-cublas-cu12 for STT..."
        pip install nvidia-cublas-cu12
        log_ok "nvidia-cublas-cu12 installed"
    fi
    deactivate
    log_ok "STT venv created and dependencies installed"
else
    log_ok "STT venv exists"
    # Ensure nvidia-cublas-cu12 is present when CUDA is available
    source "$ROOT/stt/venv/bin/activate"
    _has_cublas="$($PYTHON_BIN -c 'import importlib.util; print(importlib.util.find_spec("nvidia.cublas") is not None)' 2>/dev/null || echo False)"
    if has_cuda && [[ "$_has_cublas" == "False" ]]; then
        log "CUDA detected but nvidia-cublas-cu12 not installed — installing..."
        pip install nvidia-cublas-cu12
        log_ok "nvidia-cublas-cu12 installed"
    fi
    deactivate
fi

# ── Parse flags ──────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --tts=*)
            TTS_BACKEND="${arg#--tts=}"
            ;;
    esac
done

# Validate TTS backend
case "$TTS_BACKEND" in
    kokoro|chatterbox|dia|chattts) ;;
    *)
        echo -e "${RED}Unknown TTS backend: '$TTS_BACKEND'${RESET}"
        echo -e "${RED}Valid options: kokoro, chatterbox, dia, chattts${RESET}"
        exit 1
        ;;
esac

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
log "Starting TTS ($TTS_BACKEND) on :$TTS_PORT..."
(
    cd "$ROOT/tts"
    source venv/bin/activate
    export TTS_BACKEND="$TTS_BACKEND"
    # Reduce CUDA memory fragmentation for large models
    export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
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
    # Add nvidia cublas libs to library path for ctranslate2 CUDA support
    _pyver=$(python -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')
    _site="$ROOT/stt/venv/lib/$_pyver/site-packages"
    for _dir in "$_site/nvidia/cublas/lib" "$_site/nvidia/cublas_cu12/lib"; do
        if [[ -d "$_dir" ]]; then
            export LD_LIBRARY_PATH="$_dir:${LD_LIBRARY_PATH:-}"
        fi
    done
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
printf "  ${DIM}TTS${RESET}    http://localhost:${TTS_PORT}    ${GREEN}●${RESET}  (${TTS_BACKEND})\n"
printf "  ${DIM}STT${RESET}    http://localhost:${STT_PORT}    ${MAGENTA}●${RESET}\n"
echo ""
printf "  ${DIM}Press Ctrl+C to stop all services${RESET}\n"
echo ""

# ── Keep script alive ────────────────────────────────────
wait
