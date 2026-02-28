"""
工具注册中心 — Claude Code SDK 自带工具执行能力

本模块仅保留工具名映射（Skill yaml 声明名 → SDK 工具名），
实际工具执行由 SDK 内部完成。

SDK 内置工具：Bash, Read, Write, Edit, Glob, Grep 等
"""
from __future__ import annotations

# Skill yaml 中的工具名 → Claude Code SDK 工具名
TOOL_MAP: dict[str, str] = {
    "bash":       "Bash",
    "file_write": "Write",
    "file_read":  "Read",
}


def map_tool_names(skill_tools: list[str]) -> list[str]:
    """将 Skill 声明的工具名映射为 SDK 工具名"""
    return [TOOL_MAP.get(t, t) for t in skill_tools]
