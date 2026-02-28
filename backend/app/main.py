"""
FastAPI 入口 — 注册路由、CORS、启动事件
"""
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.tasks import router
from app.services.skill_registry import registry
from app.services.task_manager import task_manager
from app.config import CORS_ORIGINS


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动：初始化数据库并恢复任务
    await task_manager.init_db()
    # 加载所有 Skill
    registry.load_all()
    print(f"[Boot] Loaded {len(registry.list_all())} skill(s)")

    # 后台定时清理过期任务
    async def cleanup_loop():
        while True:
            await asyncio.sleep(3600)
            n = task_manager.cleanup_expired()
            if n:
                print(f"[Cleanup] Removed {n} expired task(s)")

    asyncio.create_task(cleanup_loop())
    yield


app = FastAPI(
    title="通用 Agent 平台",
    description="Skill 驱动的 Claude Agent 执行引擎",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "skills": [s.id for s in registry.list_all()],
    }
