"""
Agent 引擎 — 基于 Claude Code SDK 的执行循环

流程：
  1. 加载 Skill（System Prompt + 工具权限）
  2. 构建 prompt（含文件路径信息）
  3. 调用 claude_code_sdk.query() 启动 Agent 循环
  4. SDK 自动处理 tool_use → 执行 → 结果回传
  5. 全程解析消息流，通过 event_queue 推送 SSE 事件给前端
"""
from __future__ import annotations
import asyncio
from pathlib import Path

from claude_code_sdk import (
    query, ClaudeCodeOptions,
    AssistantMessage, UserMessage, ResultMessage,
    TextBlock, ThinkingBlock, ToolUseBlock, ToolResultBlock,
)

from app.config import CLAUDE_MODEL, CLAUDE_MAX_TURNS
from app.models.task import Task, TaskStatus, EventType, SSEEvent, StepStatus
from app.services.task_manager import task_manager
from app.services.skill_registry import Skill


# Skill 工具名 → SDK 工具名
TOOL_MAP = {
    "bash":       "Bash",
    "file_write": "Write",
    "file_read":  "Read",
}


async def run_agent(
    task: Task,
    skill: Skill,
    event_queue: asyncio.Queue,
    text_inputs: str = None,
):
    """
    启动 Agent 执行循环。
    event_queue 用于向 SSE 流推送实时事件。
    text_inputs 为用户填写的文本补充说明（可选）。
    """
    # ── 文件路径 ───────────────────────────────────────────
    workspace  = task_manager.workspace_path(task.id)
    output_dir = task_manager.output_path(task.id)
    upload_dir = task_manager.upload_path(task.id, "")

    _sync_uploads_to_workspace(upload_dir, workspace)

    # ── 构建 prompt ───────────────────────────────────────
    uploads_abs = workspace / "uploads"
    file_paths = "\n".join(
        f"  {uploads_abs / f.name}"
        for f in uploads_abs.iterdir() if f.is_file()
    ) or "  （无上传文件）"
    prompt = (
        f"请分析以下文件并完成任务。\n\n"
        f"【待处理文件（绝对路径，直接使用）】\n{file_paths}\n\n"
        f"【目录说明】\n"
        f"  当前工作目录（cwd）：{workspace}\n"
        f"  报告输出目录：{output_dir}\n\n"
        f"【重要规则】\n"
        f"  1. 不要执行 cd 命令，你已经在工作目录中\n"
        f"  2. 读取文件时使用上方列出的绝对路径\n"
        f"  3. 写报告时路径填写：{output_dir}/report.html\n"
        f"  4. 缺少 Python 包时：pip3 install <包名> --break-system-packages -q\n"
        f"  5. 【强制】执行 Python 代码必须分两步：先用 Write 工具写 .py 文件，再用 Bash 执行该文件。\n"
        f"     禁止用 heredoc / python3 -c / bash -c 等任何内联方式直接运行 Python 代码\n\n"
        f"请完成分析，用 Write 工具将最终报告写入 {output_dir}/report.html"
    )

    if text_inputs and text_inputs.strip():
        prompt += f"\n\n【用户补充说明】\n{text_inputs.strip()}"

    # ── SDK 配置 ──────────────────────────────────────────
    allowed_tools = [TOOL_MAP.get(t, t) for t in skill.tools]

    options = ClaudeCodeOptions(
        system_prompt=skill.prompt,
        allowed_tools=allowed_tools,
        max_turns=CLAUDE_MAX_TURNS,
        cwd=str(workspace),
        permission_mode="bypassPermissions",
        model=CLAUDE_MODEL,
        env={
            "CLAUDECODE": "",
            "PATH": "/home/claude-agent/.local/bin:/usr/local/bin:/usr/bin:/bin",
            "PYTHONPATH": "/home/claude-agent/.local/lib/python3.12/site-packages",
        },
    )

    task_manager.update_status(task.id, TaskStatus.RUNNING)

    # ── 立即推送一条信号，避免前端长时间空白等待 ─────────────
    # SDK 要启动 claude CLI 子进程 + 等模型第一个 token，可能 5-15s
    # 先推一个事件让前端知道 Agent 已经开始跑了
    await _push(event_queue, EventType.AGENT_TEXT, {
        "text": "正在分析文件，准备执行任务…",
        "is_loading_hint": True,       # 前端可据此做差异化样式
    })

    # ── 消息流处理 ────────────────────────────────────────
    last_text = ""
    step_map: dict[str, object] = {}
    written_files: dict[str, str] = {}   # filename → source code
    first_real_message = True             # 收到第一条真实内容后标记

    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, (AssistantMessage, UserMessage)):
                content = message.content
                if isinstance(content, str):
                    last_text = content
                    continue
                for block in content:
                    if isinstance(block, ToolUseBlock):
                        input_data = block.input if isinstance(block.input, dict) else {}
                        step_name, step_code = _extract_step_info(
                            block.name, input_data, written_files)
                        step = task.add_step(step_name, block.name)
                        step_map[block.id] = step
                        await _push(event_queue, EventType.STEP_START, {
                            "step_id":   step.id,
                            "step_name": step_name,
                            "tool":      block.name,
                            "code":      step_code,
                        })

                    elif isinstance(block, ToolResultBlock):
                        step = step_map.get(block.tool_use_id)
                        output = ""
                        if isinstance(block.content, str):
                            output = block.content[:2000]
                        elif isinstance(block.content, list):
                            output = str(block.content)[:2000]

                        file_url = _extract_file_url(output, task.id)

                        if step:
                            step.file_url = file_url
                            task.finish_step(step, output,
                                             error=bool(block.is_error))
                            await _push(event_queue, EventType.CODE_OUTPUT, {
                                "step_id": step.id,
                                "output":  output,
                                "success": not block.is_error,
                            })
                            await _push(event_queue, EventType.STEP_DONE, {
                                "step_id":     step.id,
                                "step_name":   step.name,
                                "duration_ms": step.duration_ms,
                                "file_url":    file_url,
                            })

                    elif isinstance(block, ThinkingBlock):
                        if block.thinking and block.thinking.strip():
                            await _push(event_queue, EventType.AGENT_THINKING, {
                                "thinking": block.thinking.strip(),
                            })

                    elif isinstance(block, TextBlock):
                        if block.text and block.text.strip():
                            last_text = block.text
                            await _push(event_queue, EventType.AGENT_TEXT, {
                                "text": block.text.strip(),
                            })

            elif isinstance(message, ResultMessage):
                # 捕获 session_id，供追问功能使用
                if hasattr(message, 'session_id') and message.session_id:
                    task.session_id = message.session_id
                task.last_summary = last_text

                if message.is_error:
                    task_manager.update_status(
                        task.id, TaskStatus.FAILED,
                        error=message.result or "Agent 执行失败")
                    await _push(event_queue, EventType.ERROR, {
                        "message": message.result or "Agent 执行失败",
                        "stage":   "agent_loop",
                    })
                    return

        # ── 扫描产物 ─────────────────────────────────────
        if output_dir.exists():
            for artifact in output_dir.iterdir():
                if artifact.is_file():
                    filename = artifact.name
                    await _push(event_queue, EventType.ARTIFACT_READY, {
                        "filename":     filename,
                        "download_url": f"/api/tasks/{task.id}/artifact/{filename}",
                    })
                    task.artifact_url = (
                        f"/api/tasks/{task.id}/artifact/{filename}"
                    )

        task_manager.update_status(task.id, TaskStatus.COMPLETED)
        await _push(event_queue, EventType.TASK_DONE, {
            "summary": last_text,
        })

    except Exception as e:
        task_manager.update_status(task.id, TaskStatus.FAILED, str(e))
        await _push(event_queue, EventType.ERROR, {
            "message": str(e),
            "stage":   "agent_loop",
        })


async def run_followup(
    task: Task,
    skill: Skill,
    event_queue: asyncio.Queue,
    question: str,
):
    """
    在已有 session 基础上追问。
    resume=task.session_id 恢复上一轮对话上下文。
    """
    workspace  = task_manager.workspace_path(task.id)
    output_dir = task_manager.output_path(task.id)

    # 读取已有报告片段作为上下文
    report_path = output_dir / "report.html"
    report_snippet = ""
    if report_path.exists():
        try:
            content = report_path.read_text(encoding="utf-8", errors="ignore")
            report_snippet = content[:3000]
        except Exception:
            pass

    prompt = (
        f"【上一轮分析摘要】\n{task.last_summary or '（无摘要）'}\n\n"
        f"【报告片段（前 3000 字）】\n{report_snippet}\n\n"
        f"【用户追问】\n{question.strip()}\n\n"
        f"【目录说明】\n"
        f"  当前工作目录：{workspace}\n"
        f"  报告输出目录：{output_dir}\n"
        f"  如需更新报告，写入：{output_dir}/report.html"
    )

    allowed_tools = [TOOL_MAP.get(t, t) for t in skill.tools]

    options = ClaudeCodeOptions(
        system_prompt=skill.prompt,
        allowed_tools=allowed_tools,
        max_turns=CLAUDE_MAX_TURNS,
        cwd=str(workspace),
        permission_mode="bypassPermissions",
        model=CLAUDE_MODEL,
        resume=task.session_id,
        env={
            "CLAUDECODE": "",
            "PATH": "/home/claude-agent/.local/bin:/usr/local/bin:/usr/bin:/bin",
            "PYTHONPATH": "/home/claude-agent/.local/lib/python3.12/site-packages",
        },
    )

    task_manager.update_status(task.id, TaskStatus.RUNNING)

    last_text = ""
    step_map: dict[str, object] = {}
    written_files: dict[str, str] = {}   # filename → source code

    try:
        async for message in query(prompt=prompt, options=options):
            if isinstance(message, (AssistantMessage, UserMessage)):
                content = message.content
                if isinstance(content, str):
                    last_text = content
                    continue
                for block in content:
                    if isinstance(block, ToolUseBlock):
                        input_data = block.input if isinstance(block.input, dict) else {}
                        step_name, step_code = _extract_step_info(
                            block.name, input_data, written_files)
                        step = task.add_step(step_name, block.name)
                        step_map[block.id] = step
                        await _push(event_queue, EventType.STEP_START, {
                            "step_id":   step.id,
                            "step_name": step_name,
                            "tool":      block.name,
                            "code":      step_code,
                        })

                    elif isinstance(block, ToolResultBlock):
                        step = step_map.get(block.tool_use_id)
                        output = ""
                        if isinstance(block.content, str):
                            output = block.content[:2000]
                        elif isinstance(block.content, list):
                            output = str(block.content)[:2000]

                        file_url = _extract_file_url(output, task.id)

                        if step:
                            step.file_url = file_url
                            task.finish_step(step, output,
                                             error=bool(block.is_error))
                            await _push(event_queue, EventType.CODE_OUTPUT, {
                                "step_id": step.id,
                                "output":  output,
                                "success": not block.is_error,
                            })
                            await _push(event_queue, EventType.STEP_DONE, {
                                "step_id":     step.id,
                                "step_name":   step.name,
                                "duration_ms": step.duration_ms,
                                "file_url":    file_url,
                            })

                    elif isinstance(block, ThinkingBlock):
                        if block.thinking and block.thinking.strip():
                            await _push(event_queue, EventType.AGENT_THINKING, {
                                "thinking": block.thinking.strip(),
                            })

                    elif isinstance(block, TextBlock):
                        if block.text and block.text.strip():
                            last_text = block.text
                            await _push(event_queue, EventType.AGENT_TEXT, {
                                "text": block.text.strip(),
                            })

            elif isinstance(message, ResultMessage):
                if hasattr(message, 'session_id') and message.session_id:
                    task.session_id = message.session_id
                task.last_summary = last_text

                if message.is_error:
                    task_manager.update_status(
                        task.id, TaskStatus.FAILED,
                        error=message.result or "追问执行失败")
                    await _push(event_queue, EventType.ERROR, {
                        "message": message.result or "追问执行失败",
                        "stage":   "followup_loop",
                    })
                    return

        # 扫描产物（追问可能更新了报告）
        if output_dir.exists():
            for artifact in output_dir.iterdir():
                if artifact.is_file():
                    filename = artifact.name
                    await _push(event_queue, EventType.ARTIFACT_READY, {
                        "filename":     filename,
                        "download_url": f"/api/tasks/{task.id}/artifact/{filename}",
                    })
                    task.artifact_url = f"/api/tasks/{task.id}/artifact/{filename}"

        task_manager.update_status(task.id, TaskStatus.COMPLETED)
        await _push(event_queue, EventType.TASK_DONE, {
            "summary": last_text,
        })

    except Exception as e:
        task_manager.update_status(task.id, TaskStatus.FAILED, str(e))
        await _push(event_queue, EventType.ERROR, {
            "message": str(e),
            "stage":   "followup_loop",
        })


# ── 工具函数 ───────────────────────────────────────────────

async def _push(queue: asyncio.Queue, event_type: EventType, payload: dict):
    await queue.put(SSEEvent(type=event_type, payload=payload))


def _describe_files(upload_dir: Path) -> str:
    files = list(upload_dir.glob("*"))
    if not files:
        return "（无上传文件）"
    lines = []
    for f in files:
        size_kb = f.stat().st_size // 1024
        lines.append(f"  - {f.name} ({size_kb} KB)")
    return "\n".join(lines)


def _extract_step_info(
    tool: str,
    input_data: dict,
    written_files: dict[str, str],
) -> tuple[str, str]:
    """
    从工具调用的 input 中提取：
      - 步骤展示名称（人类可读）
      - 代码内容（在右侧面板展示）

    核心优化：Bash 执行 python 文件时，返回对应的 .py 源码而非命令本身。
    """
    import re as _re

    if tool == "Write":
        path     = input_data.get("path", "")
        content  = input_data.get("content", "")
        filename = Path(path).name
        written_files[filename] = content          # 缓存，供后续 Bash 步骤引用
        if filename.endswith('.py'):
            # .py 文件由后续 Bash 步骤展示，这里只缓存不显示
            return f"写入脚本 {filename}", content
        return f"创建文件 {filename}", content

    elif tool == "Bash":
        command = input_data.get("command", "").strip()
        # 检测 python3 filename.py 形式
        m = _re.search(r'python3?\s+([\w./-]+\.py)', command)
        if m:
            py_file = Path(m.group(1)).name
            code    = written_files.get(py_file, command)  # 优先展示源码
            return f"运行代码 {py_file}", code
        # 其他 bash 命令：取第一行作为名称
        first_line = command.split('\n')[0][:60].strip() or "执行命令"
        return first_line, command

    elif tool == "Read":
        path     = input_data.get("file_path", input_data.get("path", ""))
        filename = Path(path).name
        return f"读取文件 {filename}", path

    else:
        return tool, str(input_data)[:2000]


def _extract_file_url(output: str, task_id: str) -> str | None:
    """从 Write 工具输出中提取文件路径，转换为预览 URL"""
    marker = "File created successfully at:"
    if marker not in output:
        return None
    try:
        from app.config import WORKSPACE_ROOT
        file_path = Path(output.split(marker)[-1].strip())
        task_root = (WORKSPACE_ROOT / task_id).resolve()
        rel = file_path.resolve().relative_to(task_root)
        return f"/api/tasks/{task_id}/preview/{rel}"
    except Exception:
        return None


def _sync_uploads_to_workspace(upload_dir: Path, workspace: Path):
    """把上传文件同步到 workspace/uploads/，让 Agent 可以访问"""
    target = workspace / "uploads"
    target.mkdir(exist_ok=True)
    for f in upload_dir.glob("*"):
        dest = target / f.name
        if not dest.exists():
            import shutil
            shutil.copy2(f, dest)
