"""
沙盒执行服务 — Docker 容器隔离执行代码
生产环境加 --runtime=runsc 启用 gVisor
"""
from __future__ import annotations
import asyncio
import subprocess
from pathlib import Path
from app.config import (SANDBOX_ENABLED, SANDBOX_IMAGE,
                        SANDBOX_TIMEOUT, SANDBOX_MEMORY)


class SandboxResult:
    def __init__(self, stdout: str, stderr: str, exit_code: int):
        self.stdout    = stdout
        self.stderr    = stderr
        self.exit_code = exit_code
        self.success   = exit_code == 0

    @property
    def output(self) -> str:
        return (self.stdout + ("\n" + self.stderr if self.stderr else "")).strip()


async def run_code(
    code: str,
    workspace: Path,
    image: str = SANDBOX_IMAGE,
    timeout: int = SANDBOX_TIMEOUT,
) -> SandboxResult:
    """
    在 Docker 容器中执行 Python 代码。
    workspace 目录挂载为 /workspace，代码可读写其中文件。
    """
    if not SANDBOX_ENABLED:
        # 开发模式：直接在本地执行（不隔离，仅用于调试）
        return await _run_local(code, workspace, timeout)

    return await _run_docker(code, workspace, image, timeout)


async def _run_docker(code: str, workspace: Path,
                      image: str, timeout: int) -> SandboxResult:
    cmd = [
        "docker", "run", "--rm",
        # 生产环境取消注释以启用 gVisor：
        # "--runtime=runsc",
        f"--memory={SANDBOX_MEMORY}",
        "--cpus=0.5",
        "--network=none",
        "--workdir=/workspace",
        "-v", f"{workspace.absolute()}:/workspace:rw",
        image,
        "python3", "-c", code,
    ]
    try:
        proc = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            ),
            timeout=timeout,
        )
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
        return SandboxResult(
            stdout=stdout.decode(errors="replace"),
            stderr=stderr.decode(errors="replace"),
            exit_code=proc.returncode or 0,
        )
    except asyncio.TimeoutError:
        return SandboxResult("", f"执行超时（>{timeout}s）", 124)
    except Exception as e:
        return SandboxResult("", f"沙盒启动失败: {e}", 1)


async def _run_local(code: str, workspace: Path, timeout: int) -> SandboxResult:
    """本地直接执行（开发调试用，无隔离）"""
    try:
        proc = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                "python3", "-c", code,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(workspace),
            ),
            timeout=timeout,
        )
        stdout, stderr = await proc.communicate()
        return SandboxResult(
            stdout=stdout.decode(errors="replace"),
            stderr=stderr.decode(errors="replace"),
            exit_code=proc.returncode or 0,
        )
    except asyncio.TimeoutError:
        return SandboxResult("", f"执行超时（>{timeout}s）", 124)
    except Exception as e:
        return SandboxResult("", str(e), 1)
