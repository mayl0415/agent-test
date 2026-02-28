"""
API 路由 — 任务管理 + SSE 流
"""
from __future__ import annotations
import asyncio
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import StreamingResponse, FileResponse
from app.models.task import TaskStatus, EventType, SSEEvent
from app.services.task_manager import task_manager
from app.services.skill_registry import registry
from app.services.agent import run_agent, run_followup

router = APIRouter(prefix="/api")

# task_id → asyncio.Queue（SSE 事件队列）
_event_queues: dict[str, asyncio.Queue] = {}


# ── Skill 列表 ─────────────────────────────────────────────

@router.get("/skills")
async def list_skills():
    return [
        {
            "id":          s.id,
            "name":        s.name,
            "description": s.description,
            "icon":        s.icon,
            "tags":        s.tags,
            "input":       [i.model_dump() for i in s.input],
            "output":      s.output,
        }
        for s in registry.list_all()
    ]


# ── 创建任务 ───────────────────────────────────────────────

@router.post("/tasks")
async def create_task(
    skill_id: str = Form(...),
    file: UploadFile = File(None),
    text_inputs: str = Form(None),
):
    skill = registry.get(skill_id)
    if not skill:
        raise HTTPException(404, f"Skill 不存在: {skill_id}")

    filename = file.filename if file else "（无文件）"
    task = task_manager.create(skill_id=skill_id, filename=filename)

    # 保存上传文件
    if file:
        dest = task_manager.upload_path(task.id, filename)
        content = await file.read()
        dest.write_bytes(content)

    # 创建 SSE 队列
    queue: asyncio.Queue = asyncio.Queue()
    _event_queues[task.id] = queue

    # 后台启动 Agent（不阻塞请求）
    asyncio.create_task(
        _run_and_cleanup(task, skill, queue, text_inputs=text_inputs)
    )

    return {"task_id": task.id, "status": task.status}


async def _run_and_cleanup(task, skill, queue: asyncio.Queue, text_inputs=None):
    """运行 Agent，完成后向队列注入结束信号"""
    try:
        await run_agent(task=task, skill=skill, event_queue=queue,
                        text_inputs=text_inputs)
    except Exception as e:
        from app.models.task import TaskStatus
        task_manager.update_status(task.id, TaskStatus.FAILED, str(e))
        await queue.put(SSEEvent(
            type=EventType.ERROR,
            payload={"message": str(e), "stage": "agent"}
        ))
    finally:
        # 注入 sentinel，让 SSE 生成器知道该关闭了
        await queue.put(None)


# ── 追问 ────────────────────────────────────────────────────

@router.post("/tasks/{task_id}/followup")
async def task_followup(task_id: str, question: str = Form(...)):
    task = task_manager.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    if task.status not in (TaskStatus.COMPLETED, TaskStatus.FAILED):
        raise HTTPException(400, "任务尚未完成，无法追问")
    if not task.session_id:
        raise HTTPException(400, "该任务不支持追问（缺少 session_id）")

    skill = registry.get(task.skill_id)
    if not skill:
        raise HTTPException(404, f"Skill 不存在: {task.skill_id}")

    queue: asyncio.Queue = asyncio.Queue()
    _event_queues[task_id] = queue

    asyncio.create_task(
        _run_followup_and_cleanup(task, skill, queue, question)
    )

    return {"task_id": task_id, "status": "running"}


async def _run_followup_and_cleanup(task, skill, queue: asyncio.Queue,
                                     question: str):
    """运行追问，完成后向队列注入结束信号"""
    try:
        await run_followup(task=task, skill=skill, event_queue=queue,
                           question=question)
    except Exception as e:
        task_manager.update_status(task.id, TaskStatus.FAILED, str(e))
        await queue.put(SSEEvent(
            type=EventType.ERROR,
            payload={"message": str(e), "stage": "followup"}
        ))
    finally:
        await queue.put(None)


# ── 查询任务 ───────────────────────────────────────────────

@router.get("/tasks/{task_id}")
async def get_task(task_id: str):
    task = task_manager.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")
    return {
        "id":           task.id,
        "skill_id":     task.skill_id,
        "status":       task.status,
        "filename":     task.filename,
        "artifact_url": task.artifact_url,
        "error":        task.error,
        "session_id":   task.session_id,
        "steps": [
            {
                "id":          s.id,
                "name":        s.name,
                "tool":        s.tool,
                "status":      s.status,
                "code":        s.code,
                "output":      s.output,
                "file_url":    s.file_url,
                "duration_ms": s.duration_ms,
            }
            for s in task.steps
        ],
    }


# ── SSE 事件流 ─────────────────────────────────────────────

@router.get("/tasks/{task_id}/stream")
async def task_stream(task_id: str):
    task = task_manager.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    queue = _event_queues.get(task_id)

    async def generate():
        # 心跳，保持连接
        yield ": keep-alive\n\n"

        if not queue:
            # 任务已完成，直接返回当前状态
            event = SSEEvent(
                type=EventType.TASK_DONE,
                payload={"summary": "任务已完成"}
            )
            yield event.to_sse()
            return

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25)
            except asyncio.TimeoutError:
                # 心跳保活
                yield ": keep-alive\n\n"
                continue

            if event is None:
                # sentinel — Agent 执行完毕
                _event_queues.pop(task_id, None)
                break

            yield event.to_sse()

            # 终止事件后关闭流
            if event.type in (EventType.TASK_DONE, EventType.ERROR):
                _event_queues.pop(task_id, None)
                break

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── 产物下载 ───────────────────────────────────────────────

@router.get("/tasks/{task_id}/artifact/{filename}")
async def get_artifact(task_id: str, filename: str):
    path = task_manager.output_path(task_id) / filename
    if not path.exists():
        raise HTTPException(404, "产物不存在")
    if filename.endswith(".html"):
        return FileResponse(
            path=str(path),
            media_type="text/html",
            content_disposition_type="inline",
        )
    return FileResponse(
        path=str(path),
        filename=filename,
        media_type="application/octet-stream",
    )


# ── 中间文件预览 ───────────────────────────────────────────

PREVIEWABLE_TYPES = {
    ".html": "text/html",
    ".htm":  "text/html",
    ".txt":  "text/plain",
    ".csv":  "text/plain",
    ".json": "application/json",
    ".py":   "text/plain",
    ".md":   "text/plain",
    ".log":  "text/plain",
}

@router.get("/tasks/{task_id}/preview/{filepath:path}")
async def preview_file(task_id: str, filepath: str):
    task = task_manager.get(task_id)
    if not task:
        raise HTTPException(404, "任务不存在")

    from app.config import WORKSPACE_ROOT
    task_root = (WORKSPACE_ROOT / task_id).resolve()
    full_path = (task_root / filepath).resolve()

    # 安全检查：只允许访问任务目录内的文件
    if not str(full_path).startswith(str(task_root)):
        raise HTTPException(403, "访问被拒绝")
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(404, "文件不存在")

    suffix = full_path.suffix.lower()
    media_type = PREVIEWABLE_TYPES.get(suffix, "application/octet-stream")
    return FileResponse(
        path=str(full_path),
        media_type=media_type,
        content_disposition_type="inline",
    )


# ── 删除任务 ───────────────────────────────────────────────

@router.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    ok = task_manager.delete(task_id)
    if not ok:
        raise HTTPException(404, "任务不存在")
    return {"deleted": task_id}
