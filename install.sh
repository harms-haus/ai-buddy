#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────
#  AI Buddy Installer
#  Installs all dependencies and creates a systemd service
#  that starts on boot.
#
#  Usage:  sudo ./install.sh                    (default: kokoro TTS)
#          sudo ./install.sh --tts=chatterbox   (choose TTS backend)
#          sudo ./install.sh --uninstall        (remove service)
# ──────────────────────────────────────────────────────────
set -euo pipefail

# Must run as root for systemd
if [[ $EUID -ne 0 ]]; then
    echo "Please run as root: sudo ./install.sh"
    exit 1
fi

cd "$(dirname "$0")"
ROOT="$(pwd)"

# ── Colors ────────────────────────────────────────────────
RED=$'\033[31m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
BOLD=$'\033[1m'
DIM=$'\033[2m'
RESET=$'\033[0m'

# ── Defaults ──────────────────────────────────────────────
REQUIRED_NODE_MAJOR=22
PYTHON_BIN="python3"
TTS_BACKEND="kokoro"
SERVICE_NAME="ai-buddy"
SERVICE_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
SERVICE_GROUP="$SERVICE_USER"
LOG_DIR="/var/log/$SERVICE_NAME"

# ── Parse flags ──────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --tts=*)
            TTS_BACKEND="${arg#--tts=}"
            ;;
        --user=*)
            SERVICE_USER="${arg#--user=}"
            SERVICE_GROUP="$SERVICE_USER"
            ;;
        --uninstall)
            ACTION="uninstall"
            ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────
log()    { printf "${YELLOW}${BOLD}[install]${RESET} %s\n" "$*"; }
log_ok() { printf "${YELLOW}${BOLD}[install]${RESET} ${GREEN}✓${RESET} %s\n" "$*"; }
log_err(){ printf "${RED}${BOLD}[install] ✗${RESET} %s\n" "$*" >&2; }

has_cuda() {
    command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null
}

# ══════════════════════════════════════════════════════════
#  UNINSTALL
# ══════════════════════════════════════════════════════════
if [[ "${ACTION:-}" == "uninstall" ]]; then
    log "Uninstalling $SERVICE_NAME service..."
    systemctl stop "$SERVICE_NAME.service" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME.service" 2>/dev/null || true
    rm -f "/etc/systemd/system/$SERVICE_NAME.service"
    systemctl daemon-reload
    log_ok "Service removed"
    exit 0
fi

# Validate TTS backend
case "$TTS_BACKEND" in
    kokoro|chatterbox|dia|chattts) ;;
    *)
        log_err "Unknown TTS backend: '$TTS_BACKEND'"
        log_err "Valid options: kokoro, chatterbox, dia, chattts"
        exit 1
        ;;
esac

log "Installing AI Buddy (TTS backend: $TTS_BACKEND, user: $SERVICE_USER)..."

# ══════════════════════════════════════════════════════════
#  1. PREREQUISITES
# ══════════════════════════════════════════════════════════

# ── Python 3 ─────────────────────────────────────────────
if ! command -v $PYTHON_BIN &>/dev/null; then
    log "Installing Python 3..."
    apt-get update -qq && apt-get install -y -qq python3 python3-venv python3-pip
fi
log_ok "$($PYTHON_BIN --version)"

# ── Node.js ──────────────────────────────────────────────
install_node() {
    log "Installing Node.js ${REQUIRED_NODE_MAJOR}.x via nvm for user $SERVICE_USER..."
    _home=$(eval echo "~$SERVICE_USER")
    if [[ ! -d "$_home/.nvm" ]]; then
        su - "$SERVICE_USER" -c 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash'
    fi
    su - "$SERVICE_USER" -c "source '$_home/.nvm/nvm.sh' && nvm install $REQUIRED_NODE_MAJOR && nvm use $REQUIRED_NODE_MAJOR"
}

if command -v node &>/dev/null; then
    NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
    if (( NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
        log_err "Node.js $(node --version) is too old (need >= ${REQUIRED_NODE_MAJOR}.x)"
        install_node
    else
        log_ok "Node.js $(node --version)"
    fi
else
    install_node
fi

# Resolve the node binary path (may be via nvm)
if [[ -f "$(eval echo "~$SERVICE_USER")/.nvm/versions/node/$(su - "$SERVICE_USER" -c 'source ~/.nvm/nvm.sh && nvm current')/bin/node" ]]; then
    NODE_BIN="$(eval echo "~$SERVICE_USER")/.nvm/versions/node/$(su - "$SERVICE_USER" -c 'source ~/.nvm/nvm.sh && nvm current')/bin/node"
else
    NODE_BIN=$(which node)
fi
log_ok "Node binary: $NODE_BIN"

# ── Ensure agent/data directory exists ───────────────────
mkdir -p "$ROOT/agent/data"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/agent/data"
log_ok "agent/data/ directory ready"

# ══════════════════════════════════════════════════════════
#  2. PYTHON VIRTUAL ENVIRONMENTS
# ══════════════════════════════════════════════════════════

# ── TTS venv ─────────────────────────────────────────────
if [[ ! -f "$ROOT/tts/venv/bin/activate" ]]; then
    log "Creating TTS virtual environment..."
    rm -rf "$ROOT/tts/venv"
    $PYTHON_BIN -m venv "$ROOT/tts/venv"
    source "$ROOT/tts/venv/bin/activate"
    pip install --upgrade pip
    pip install -r "$ROOT/tts/requirements.txt"
    if has_cuda; then
        log "CUDA detected — installing onnxruntime-gpu + CUDA runtime libs for TTS..."
        pip uninstall -y onnxruntime 2>/dev/null || true
        pip install onnxruntime-gpu nvidia-cublas-cu12 nvidia-cuda-runtime-cu12 nvidia-curand-cu12 nvidia-cudnn-cu12 nvidia-cufft-cu12 nvidia-cusolver-cu12 nvidia-cusparse-cu12 nvidia-cuda-nvrtc-cu12 nvidia-nvjitlink-cu12
        log_ok "onnxruntime-gpu + CUDA libs installed"
    fi
    deactivate
    log_ok "TTS venv created"
else
    log_ok "TTS venv exists"
    source "$ROOT/tts/venv/bin/activate"
    _has_gpu_rt="$($PYTHON_BIN -c 'import importlib.util; print(importlib.util.find_spec("onnxruntime-gpu") is not None)' 2>/dev/null || echo False)"
    _has_cublas="$($PYTHON_BIN -c 'import importlib.util; print(importlib.util.find_spec("nvidia.cublas") is not None)' 2>/dev/null || echo False)"
    if has_cuda && [[ "$_has_gpu_rt" == "False" || "$_has_cublas" == "False" ]]; then
        log "CUDA detected — installing onnxruntime-gpu + CUDA runtime libs for TTS..."
        pip uninstall -y onnxruntime 2>/dev/null || true
        pip install onnxruntime-gpu nvidia-cublas-cu12 nvidia-cuda-runtime-cu12 nvidia-curand-cu12 nvidia-cudnn-cu12 nvidia-cufft-cu12 nvidia-cusolver-cu12 nvidia-cusparse-cu12 nvidia-cuda-nvrtc-cu12 nvidia-nvjitlink-cu12
        log_ok "onnxruntime-gpu + CUDA libs installed"
    fi
    deactivate
fi

# ── STT venv ─────────────────────────────────────────────
if [[ ! -f "$ROOT/stt/venv/bin/activate" ]]; then
    log "Creating STT virtual environment..."
    rm -rf "$ROOT/stt/venv"
    $PYTHON_BIN -m venv "$ROOT/stt/venv"
    source "$ROOT/stt/venv/bin/activate"
    pip install --upgrade pip
    pip install -r "$ROOT/stt/requirements.txt"
    if has_cuda; then
        log "CUDA detected — installing nvidia-cublas-cu12 for STT..."
        pip install nvidia-cublas-cu12
        log_ok "nvidia-cublas-cu12 installed"
    fi
    deactivate
    log_ok "STT venv created"
else
    log_ok "STT venv exists"
    source "$ROOT/stt/venv/bin/activate"
    _has_cublas="$($PYTHON_BIN -c 'import importlib.util; print(importlib.util.find_spec("nvidia.cublas") is not None)' 2>/dev/null || echo False)"
    if has_cuda && [[ "$_has_cublas" == "False" ]]; then
        log "CUDA detected but nvidia-cublas-cu12 not installed — installing..."
        pip install nvidia-cublas-cu12
        log_ok "nvidia-cublas-cu12 installed"
    fi
    deactivate
fi

# Fix ownership if running as a different user
if [[ "$SERVICE_USER" != "root" ]]; then
    chown -R "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/tts/venv" "$ROOT/stt/venv" "$ROOT/agent"
fi

# ══════════════════════════════════════════════════════════
#  3. BUILD AGENT
# ══════════════════════════════════════════════════════════
log "Building agent..."
(
    cd "$ROOT/agent"
    # Source nvm if present so npm is available
    _nvm_dir="$(eval echo "~$SERVICE_USER")/.nvm"
    if [[ -f "$_nvm_dir/nvm.sh" ]]; then
        source "$_nvm_dir/nvm.sh"
    fi
    export PATH="$ROOT/agent/node_modules/.bin:$PATH"
    npm install 2>&1
    npm run build 2>&1
    # Prune dev dependencies after build (runtime uses .mastra/output bundle, not mastra CLI)
    npm prune --omit=dev 2>&1 || true
)
log_ok "Agent built"

# ══════════════════════════════════════════════════════════
#  4. CREATE LAUNCHER SCRIPT
# ══════════════════════════════════════════════════════════
# The service runs a single script that manages all 3 processes.
LAUNCHER="$ROOT/.service-launch.sh"

log "Creating launcher script..."
cat > "$LAUNCHER" << LAUNCHER_EOF
#!/usr/bin/env bash
# Auto-generated by install.sh — do not edit
set -euo pipefail
ROOT="$ROOT"
TTS_BACKEND="$TTS_BACKEND"
PYTHON_BIN="$PYTHON_BIN"

# Source nvm if available
_nvm_dir="$(eval echo "~$SERVICE_USER")/.nvm"
[[ -f "\$_nvm_dir/nvm.sh" ]] && source "\$_nvm_dir/nvm.sh"

PIDS=()

# Truncate logs on start (avoid stale output from previous runs)
for _log in "$LOG_DIR"/stt.log "$LOG_DIR"/tts.log "$LOG_DIR"/agent.log; do
    : > "\$_log"
done

cleanup() {
    echo "[ai-buddy] Shutting down..."
    for pid in "\${PIDS[@]}"; do
        kill "\$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
    echo "[ai-buddy] All services stopped"
    exit 0
}
trap cleanup EXIT INT TERM

# ── STT ───────────────────────────────────────────────────
echo "[ai-buddy] Starting STT..."
(
    cd "\$ROOT/stt"
    source venv/bin/activate
    # Add nvidia pip package lib dirs to LD_LIBRARY_PATH
    _pyver=\$(python -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')
    for _dir in "\$ROOT/stt/venv/lib/\$_pyver/site-packages/nvidia"/*/lib; do
        [[ -d "\$_dir" ]] && export LD_LIBRARY_PATH="\$_dir:\${LD_LIBRARY_PATH:-}"
    done
    PYTHONUNBUFFERED=1 python server.py 2>&1
) >> "$LOG_DIR/stt.log" 2>&1 &
PIDS+=(\$!)

# ── TTS ───────────────────────────────────────────────────
echo "[ai-buddy] Starting TTS (\$TTS_BACKEND)..."
(
    cd "\$ROOT/tts"
    source venv/bin/activate
    export TTS_BACKEND="\$TTS_BACKEND"
    export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
    if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
        export ONNX_PROVIDER=CUDAExecutionProvider
        _pyver=\$(python -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')
        for _dir in "\$ROOT/tts/venv/lib/\$_pyver/site-packages/nvidia"/*/lib; do
            [[ -d "\$_dir" ]] && export LD_LIBRARY_PATH="\$_dir:\${LD_LIBRARY_PATH:-}"
        done
    fi
    PYTHONUNBUFFERED=1 python server.py 2>&1
) >> "$LOG_DIR/tts.log" 2>&1 &
PIDS+=(\$!)

# ── Agent ─────────────────────────────────────────────────
echo "[ai-buddy] Starting Agent..."
(
    cd "\$ROOT/agent"
    # Load .env into environment (mastra start did this automatically,
    # but node .mastra/output/index.mjs does not)
    if [[ -f .env ]]; then
        eval "$(node -e \"const p=require('dotenv').config();Object.keys(p.parsed||{}).forEach(k=>console.log('export '+k+'='+JSON.stringify(p.parsed[k])))\" )" || true
    fi
    node .mastra/output/index.mjs 2>&1
) >> "$LOG_DIR/agent.log" 2>&1 &
PIDS+=(\$!)

echo "[ai-buddy] All services started"
wait
LAUNCHER_EOF

chmod +x "$LAUNCHER"
chown "$SERVICE_USER:$SERVICE_GROUP" "$LAUNCHER"
log_ok "Launcher script created"

# ══════════════════════════════════════════════════════════
#  5. SETUP LOG DIRECTORY
# ══════════════════════════════════════════════════════════
mkdir -p "$LOG_DIR"
chown -R "$SERVICE_USER:$SERVICE_GROUP" "$LOG_DIR"
log_ok "Log directory: $LOG_DIR"

# ══════════════════════════════════════════════════════════
#  6. CREATE SYSTEMD SERVICE
# ══════════════════════════════════════════════════════════
SERVICE_FILE="/etc/systemd/system/$SERVICE_NAME.service"

log "Creating systemd service..."

# Only add nvm dir to ReadWritePaths if it exists
NVM_RW_PATH=""
_nvm_home="$(eval echo "~$SERVICE_USER")/.nvm"
if [[ -d "$_nvm_home" ]]; then
    NVM_RW_PATH="$_nvm_home"
fi

cat > "$SERVICE_FILE" << EOF
[Unit]
Description=AI Buddy (Agent + TTS + STT)
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_GROUP
WorkingDirectory=$ROOT
ExecStart=$LAUNCHER
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# Environment
Environment=NODE_ENV=production
Environment=TTS_BACKEND=$TTS_BACKEND
Environment=HOME=$(eval echo "~$SERVICE_USER")

# Hardening
ProtectSystem=strict
ReadWritePaths=$ROOT $LOG_DIR${NVM_RW_PATH:+ $NVM_RW_PATH}
PrivateTmp=true
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME.service"
log_ok "Service installed and enabled on boot"

# ══════════════════════════════════════════════════════════
#  7. START SERVICE
# ══════════════════════════════════════════════════════════
log "Starting $SERVICE_NAME service..."
systemctl restart "$SERVICE_NAME.service"

# Wait a moment and show status
sleep 3
echo ""
if systemctl is-active --quiet "$SERVICE_NAME.service"; then
    printf "${GREEN}${BOLD}  ✦ AI Buddy installed and running ✦${RESET}\n"
else
    printf "${RED}${BOLD}  ✦ Service started but may have issues — check logs ✦${RESET}\n"
fi
echo ""
echo "  Commands:"
echo "    systemctl status $SERVICE_NAME     (check status)"
echo "    journalctl -u $SERVICE_NAME -f     (follow logs)"
echo "    systemctl restart $SERVICE_NAME    (restart)"
echo "    systemctl stop $SERVICE_NAME       (stop)"
echo ""
echo "  Logs:  $LOG_DIR/"
echo "           stt.log"
echo "           tts.log"
echo "           agent.log"
echo ""
echo "  Uninstall:  sudo ./install.sh --uninstall"
echo ""
