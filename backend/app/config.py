"""
全局配置模块 — 从环境变量读取，提供默认值
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# ── 路径 ──────────────────────────────────────────────────
BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env", override=True)
SKILLS_DIR = BASE_DIR / "skills"
WORKSPACE_ROOT = Path(os.getenv("WORKSPACE_ROOT", str(BASE_DIR / "data" / "tasks"))).resolve()
WORKSPACE_ROOT.mkdir(parents=True, exist_ok=True)

# ── Claude Code SDK ─────────────────────────────────────────
# SDK 自动读取 ANTHROPIC_API_KEY 环境变量，无需在此配置
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", None)  # None = SDK 默认模型
CLAUDE_MAX_TURNS = int(os.getenv("CLAUDE_MAX_TURNS", "20"))

# ── 沙盒 ──────────────────────────────────────────────────
SANDBOX_IMAGE = os.getenv("SANDBOX_IMAGE", "python:3.11-slim")
SANDBOX_ENABLED = os.getenv("SANDBOX_ENABLED", "true").lower() == "true"
SANDBOX_TIMEOUT = int(os.getenv("SANDBOX_TIMEOUT", "60"))
SANDBOX_MEMORY = os.getenv("SANDBOX_MEMORY", "512m")

# ── 任务 ──────────────────────────────────────────────────
TASK_TTL_SECONDS = int(os.getenv("TASK_TTL_SECONDS", "86400"))  # 24h

# ── 服务 ──────────────────────────────────────────────────
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")
