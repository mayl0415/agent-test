"""
任务管理器 — 内存缓存 + SQLite 持久化 + 文件系统生命周期管理

目录结构（每个任务独立）：
  {WORKSPACE_ROOT}/{task_id}/
      uploads/     用户上传的原始文件（只读）
      workspace/   Agent 工作区（沙盒挂载点）
      output/      最终产物（HTML 报告等）
"""
from __future__ import annotations
import asyncio
import shutil
from pathlib import Path
from typing import Optional
from datetime import datetime, timedelta

import aiosqlite

from app.models.task import Task, TaskStatus
from app.config import WORKSPACE_ROOT, TASK_TTL_SECONDS

DB_PATH = WORKSPACE_ROOT.parent / "tasks.db"


class TaskManager:

    def __init__(self):
        self._tasks: dict[str, Task] = {}
        self._db_path = DB_PATH

    # ── 初始化 / 恢复 ─────────────────────────────────────────

    async def init_db(self):
        """建表 + 恢复已有任务（main.py lifespan 调用）"""
        async with aiosqlite.connect(self._db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY,
                    data TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.commit()
            async with db.execute("SELECT data FROM tasks") as cur:
                rows = await cur.fetchall()

        for (data_json,) in rows:
            try:
                task = Task.model_validate_json(data_json)
                if task.status == TaskStatus.RUNNING:
                    task.status = TaskStatus.FAILED
                    task.error = "服务重启，任务中断"
                self._tasks[task.id] = task
                # 确保文件目录存在（可能是新机器或清理过）
                for sub in ("uploads", "workspace", "output"):
                    self._task_dir(task.id, sub).mkdir(parents=True, exist_ok=True)
            except Exception as e:
                print(f"[TaskManager] 恢复任务失败: {e}")

        print(f"[TaskManager] 从数据库恢复 {len(rows)} 个任务")

    # ── CRUD ──────────────────────────────────────────────────

    def create(self, skill_id: str, filename: str) -> Task:
        task = Task(skill_id=skill_id, filename=filename)
        self._tasks[task.id] = task
        # 建立三层目录
        for sub in ("uploads", "workspace", "output"):
            self._task_dir(task.id, sub).mkdir(parents=True, exist_ok=True)
        self._schedule_persist(task)
        return task

    def get(self, task_id: str) -> Optional[Task]:
        return self._tasks.get(task_id)

    def update_status(self, task_id: str, status: TaskStatus,
                      error: str = "") -> None:
        task = self._tasks.get(task_id)
        if task:
            task.status = status
            if error:
                task.error = error
            task.touch()
            self._schedule_persist(task)

    def delete(self, task_id: str) -> bool:
        task = self._tasks.pop(task_id, None)
        if task:
            shutil.rmtree(self._task_dir(task_id), ignore_errors=True)
            self._schedule_db_delete(task_id)
            return True
        return False

    # ── 文件路径 ───────────────────────────────────────────────

    def _task_dir(self, task_id: str, sub: str = "") -> Path:
        base = WORKSPACE_ROOT / task_id
        return base / sub if sub else base

    def upload_path(self, task_id: str, filename: str) -> Path:
        """返回上传文件的目标路径"""
        return self._task_dir(task_id, "uploads") / filename

    def workspace_path(self, task_id: str) -> Path:
        """沙盒挂载目录"""
        return self._task_dir(task_id, "workspace")

    def output_path(self, task_id: str) -> Path:
        return self._task_dir(task_id, "output")

    def list_outputs(self, task_id: str) -> list[Path]:
        return list(self.output_path(task_id).iterdir())

    # ── TTL 清理 ───────────────────────────────────────────────

    def cleanup_expired(self) -> int:
        """清理超过 TTL 的任务，返回清理数量"""
        cutoff = datetime.utcnow() - timedelta(seconds=TASK_TTL_SECONDS)
        expired = [
            tid for tid, t in self._tasks.items()
            if t.created_at < cutoff and t.status in
               (TaskStatus.COMPLETED, TaskStatus.FAILED)
        ]
        for tid in expired:
            self.delete(tid)
        return len(expired)

    def list_all(self) -> list[Task]:
        return list(self._tasks.values())

    # ── SQLite 持久化 ─────────────────────────────────────────

    async def _persist(self, task: Task):
        try:
            async with aiosqlite.connect(self._db_path) as db:
                await db.execute(
                    "INSERT INTO tasks(id, data, updated_at) VALUES(?, ?, ?) "
                    "ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
                    (task.id, task.model_dump_json(), task.updated_at.isoformat())
                )
                await db.commit()
        except Exception as e:
            print(f"[TaskManager] 持久化失败 {task.id}: {e}")

    def _schedule_persist(self, task: Task):
        try:
            asyncio.get_running_loop().create_task(self._persist(task))
        except RuntimeError:
            pass

    def _schedule_db_delete(self, task_id: str):
        async def _del():
            try:
                async with aiosqlite.connect(self._db_path) as db:
                    await db.execute("DELETE FROM tasks WHERE id=?", (task_id,))
                    await db.commit()
            except Exception as e:
                print(f"[TaskManager] 删除任务失败 {task_id}: {e}")

        try:
            asyncio.get_running_loop().create_task(_del())
        except RuntimeError:
            pass


# 全局单例
task_manager = TaskManager()
