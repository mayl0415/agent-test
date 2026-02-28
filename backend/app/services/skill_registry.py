"""
Skill 管理器 — 从文件系统加载 Skill，缓存到内存
新增 Skill 只需在 skills/ 目录下新建文件夹
"""
from __future__ import annotations
import yaml
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from app.config import SKILLS_DIR


# ── Skill 数据结构 ─────────────────────────────────────────

class SkillInput(BaseModel):
    type:     str              # file | text
    accept:   list[str] = []   # 文件类型白名单
    label:    str = ""
    required: bool = True
    max_size: str = "50mb"


class SkillSandbox(BaseModel):
    enabled: bool = False
    image:   str  = "python:3.11-slim"
    timeout: int  = 60


class SkillMemory(BaseModel):
    short_term: bool = True   # 对话历史
    long_term:  bool = False  # 向量库（预留）


class Skill(BaseModel):
    # 元信息
    id:          str
    name:        str
    description: str
    icon:        str = "🤖"
    tags:        list[str] = []

    # 能力声明
    tools:   list[str]   = ["bash", "file_write"]
    sandbox: SkillSandbox = SkillSandbox()
    input:   list[SkillInput] = []
    output:  str = "html_report"   # html_report | markdown | text
    memory:  SkillMemory = SkillMemory()

    # 运行时（不序列化）
    prompt:  str = ""              # prompt.md 内容

    @property
    def accepts_files(self) -> bool:
        return any(i.type == "file" for i in self.input)

    @property
    def accepted_extensions(self) -> list[str]:
        exts = []
        for i in self.input:
            if i.type == "file":
                exts.extend(i.accept)
        return exts


# ── Skill 注册表 ───────────────────────────────────────────

class SkillRegistry:
    """启动时扫描 skills/ 目录，加载所有合法 Skill"""

    def __init__(self):
        self._skills: dict[str, Skill] = {}

    def load_all(self):
        self._skills.clear()
        if not SKILLS_DIR.exists():
            return
        for skill_dir in sorted(SKILLS_DIR.iterdir()):
            if not skill_dir.is_dir():
                continue
            skill = self._load_one(skill_dir)
            if skill:
                self._skills[skill.id] = skill
                print(f"[Skill] Loaded: {skill.id} — {skill.name}")

    def _load_one(self, skill_dir: Path) -> Optional[Skill]:
        yaml_path   = skill_dir / "skill.yaml"
        prompt_path = skill_dir / "prompt.md"
        if not yaml_path.exists() or not prompt_path.exists():
            return None
        try:
            meta   = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))
            prompt = prompt_path.read_text(encoding="utf-8")
            skill  = Skill(id=skill_dir.name, prompt=prompt, **meta)
            return skill
        except Exception as e:
            print(f"[Skill] Failed to load {skill_dir.name}: {e}")
            return None

    def get(self, skill_id: str) -> Optional[Skill]:
        return self._skills.get(skill_id)

    def list_all(self) -> list[Skill]:
        return list(self._skills.values())


# 全局单例
registry = SkillRegistry()
