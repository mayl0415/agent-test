"""
数据模型定义 — Task 生命周期、步骤、SSE 事件
"""
from __future__ import annotations
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field
from datetime import datetime
import uuid


# ── 枚举 ──────────────────────────────────────────────────

class TaskStatus(str, Enum):
    PENDING   = "pending"
    RUNNING   = "running"
    COMPLETED = "completed"
    FAILED    = "failed"


class StepStatus(str, Enum):
    WAITING = "waiting"
    RUNNING = "running"
    DONE    = "done"
    ERROR   = "error"


class EventType(str, Enum):
    STEP_START     = "step_start"      # Agent 开始一个工具调用
    CODE_OUTPUT    = "code_output"     # 沙盒执行结果
    STEP_DONE      = "step_done"       # 单步完成
    AGENT_TEXT     = "agent_text"      # 模型中间文字输出（工具调用之间）
    AGENT_THINKING = "agent_thinking"  # 模型扩展思考内容（ThinkingBlock）
    ARTIFACT_READY = "artifact_ready"  # 产物生成
    TASK_DONE      = "task_done"       # 全部完成
    ERROR          = "error"           # 任务失败
    HEARTBEAT      = "heartbeat"       # SSE 保活


# ── Step ──────────────────────────────────────────────────

class Step(BaseModel):
    id:          str        = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name:        str        = ""
    tool:        str        = ""          # bash / file_write / http_request
    code:        str        = ""          # 执行的代码（折叠展示用）
    output:      str        = ""          # stdout 前 500 字符
    file_url:    Optional[str] = None    # 产出文件的预览 URL
    status:      StepStatus = StepStatus.WAITING
    started_at:  Optional[datetime] = None
    finished_at: Optional[datetime] = None

    @property
    def duration_ms(self) -> Optional[int]:
        if self.started_at and self.finished_at:
            return int((self.finished_at - self.started_at).total_seconds() * 1000)
        return None


# ── Task ──────────────────────────────────────────────────

class Task(BaseModel):
    id:           str        = Field(default_factory=lambda: str(uuid.uuid4()))
    skill_id:     str        = ""
    status:       TaskStatus = TaskStatus.PENDING
    filename:     str        = ""
    steps:        list[Step] = Field(default_factory=list)
    artifact_url: Optional[str] = None
    error:        Optional[str] = None
    created_at:   datetime   = Field(default_factory=datetime.utcnow)
    updated_at:   datetime   = Field(default_factory=datetime.utcnow)

    # 对话历史（短期记忆）— 传给 Claude API 的 messages 列表
    messages:     list[dict] = Field(default_factory=list)

    # 追问支持
    session_id:   Optional[str] = None   # 最后一轮 query 的会话 ID
    last_summary: Optional[str] = None   # 最后一轮的文字摘要

    def touch(self):
        self.updated_at = datetime.utcnow()

    def add_step(self, name: str, tool: str) -> Step:
        step = Step(name=name, tool=tool, status=StepStatus.RUNNING,
                    started_at=datetime.utcnow())
        self.steps.append(step)
        self.touch()
        return step

    def finish_step(self, step: Step, output: str = "", error: bool = False):
        step.output = output[:500]
        step.status = StepStatus.ERROR if error else StepStatus.DONE
        step.finished_at = datetime.utcnow()
        self.touch()


# ── SSE Events ────────────────────────────────────────────

class SSEEvent(BaseModel):
    type:    EventType
    payload: dict[str, Any] = Field(default_factory=dict)

    def to_sse(self) -> str:
        """格式化为 SSE wire format"""
        import json
        data = json.dumps({"type": self.type, **self.payload}, ensure_ascii=False,
                          default=str)
        return f"data: {data}\n\n"
