#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
#  Agent 平台一键启动脚本
#  用法: ./start.sh [--no-frontend] [--no-backend] [--stop]
# ─────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
PID_DIR="$SCRIPT_DIR/.pids"
BACKEND_LOG="$SCRIPT_DIR/backend.log"
FRONTEND_LOG="$SCRIPT_DIR/frontend.log"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── 解析参数 ─────────────────────────────────────────────────
RUN_BACKEND=true
RUN_FRONTEND=true
for arg in "$@"; do
  case $arg in
    --no-frontend) RUN_FRONTEND=false ;;
    --no-backend)  RUN_BACKEND=false  ;;
    --stop)        ACTION=stop        ;;
  esac
done

mkdir -p "$PID_DIR"

# ── 停止服务 ─────────────────────────────────────────────────
stop_services() {
  info "正在停止服务..."
  shopt -s nullglob
  for pidfile in "$PID_DIR"/*.pid; do
    [ -f "$pidfile" ] || continue
    pid=$(cat "$pidfile")
    name=$(basename "$pidfile" .pid)
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" && info "已停止 $name (PID $pid)"
    fi
    rm -f "$pidfile"
  done
  # 兜底：清理可能残留的 uvicorn / next-server 进程
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -f "next-server" 2>/dev/null || true
  info "所有服务已停止。"
}

if [ "${ACTION:-}" = "stop" ]; then
  stop_services
  exit 0
fi

# ── 加载 .env（如果存在）────────────────────────────────────
if [ -f "$BACKEND_DIR/.env" ]; then
  set +e
  source <(grep -v '^#' "$BACKEND_DIR/.env" | grep '=' 2>/dev/null)
  set -e
fi
# claude-code-sdk 自动读取 ~/.claude/.credentials.json，无需 API Key

# ── 启动后端 ─────────────────────────────────────────────────
start_backend() {
  info "启动后端 (FastAPI)..."

  # 检查/创建 venv
  if [ ! -f "$BACKEND_DIR/venv/bin/activate" ]; then
    info "创建 Python 虚拟环境..."
    python3 -m venv "$BACKEND_DIR/venv"
  fi

  # 激活 venv 并安装依赖
  # shellcheck disable=SC1091
  source "$BACKEND_DIR/venv/bin/activate"
  pip install -q -r "$BACKEND_DIR/requirements.txt"

  # claude --dangerously-skip-permissions 不允许 root 运行
  # 创建专用非 root 用户并以该用户启动 uvicorn
  if [ "$(id -u)" = "0" ]; then
    useradd -m -s /bin/bash claude-agent 2>/dev/null || true
    chown -R claude-agent "$BACKEND_DIR"
    RUN_PREFIX="su -s /bin/bash claude-agent -c"

    # 预装常用 Python 包（只在首次执行，避免每次重装）
    MARKER="/home/claude-agent/.local/.pkgs_installed"
    if [ ! -f "$MARKER" ]; then
      info "预装 Python 数据分析包..."
      su -s /bin/bash claude-agent -c \
        "pip3 install pandas numpy matplotlib scipy seaborn plotly openpyxl pdfplumber python-docx --break-system-packages -q" \
        && touch "$MARKER" \
        && info "包安装完成 ✓" \
        || warn "部分包安装失败，Agent 运行时会自动补装"
    fi
  else
    RUN_PREFIX="bash -c"
  fi

  # 启动
  UVICORN_CMD="cd '$BACKEND_DIR' && '$BACKEND_DIR/venv/bin/uvicorn' app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app"
  $RUN_PREFIX "$UVICORN_CMD" > "$BACKEND_LOG" 2>&1 &
  echo $! > "$PID_DIR/backend.pid"
  info "后端已启动 (PID $!) → http://localhost:8000  日志: backend.log"

  # 等待健康检查
  info "等待后端就绪..."
  for i in $(seq 1 15); do
    if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
      info "后端健康检查通过 ✓"
      return
    fi
    sleep 1
  done
  warn "后端 15s 内未响应 /health，请查看 backend.log"
}

# ── 启动前端 ─────────────────────────────────────────────────
start_frontend() {
  info "启动前端 (Next.js)..."

  # 检查 node_modules
  if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
    info "安装前端依赖..."
    cd "$FRONTEND_DIR" && npm install
  fi

  cd "$FRONTEND_DIR"
  npm run dev > "$FRONTEND_LOG" 2>&1 &
  echo $! > "$PID_DIR/frontend.pid"
  info "前端已启动 (PID $!) → http://localhost:3000  日志: frontend.log"
}

# ── 清理已有进程 ─────────────────────────────────────────────
stop_services 2>/dev/null || true

# ── 主流程 ───────────────────────────────────────────────────
$RUN_BACKEND  && start_backend
$RUN_FRONTEND && start_frontend

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Agent 平台已启动${NC}"
$RUN_BACKEND  && echo -e "  后端: http://localhost:8000"
$RUN_FRONTEND && echo -e "  前端: http://localhost:3000"
echo -e "  停止: ./start.sh --stop"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
