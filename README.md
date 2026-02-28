# 通用 Agent 平台

Skill 驱动的 Claude Agent 执行引擎，支持文件分析、报告生成等任务。

## 目录结构

```
agent-platform/
├── backend/          # Python / FastAPI
│   ├── app/
│   │   ├── main.py           # 入口
│   │   ├── config.py         # 配置
│   │   ├── api/tasks.py      # API 路由 + SSE
│   │   ├── services/
│   │   │   ├── agent.py      # Agent 执行循环（核心）
│   │   │   ├── skill_registry.py  # Skill 加载
│   │   │   ├── task_manager.py    # 任务 + 文件管理
│   │   │   └── sandbox.py    # Docker 沙盒
│   │   ├── tools/registry.py # 工具注册中心
│   │   └── models/task.py    # 数据模型
│   └── skills/
│       ├── data-viz/         # 数据可视化 Skill
│       └── doc-reader/       # 文档摘要 Skill
└── frontend/         # Next.js / TypeScript
    └── src/
        ├── app/              # 页面
        ├── hooks/useTaskStream.ts  # SSE Hook
        └── lib/              # 类型 + API
```

## 快速启动

### 1. 后端

```bash
cd backend
cp .env.example .env
# 填写 ANTHROPIC_API_KEY

pip install -r requirements.txt
uvicorn app.main:app --reload
# 访问 http://localhost:8000/health 验证
```

### 2. 前端

```bash
cd frontend
npm install
npm run dev
# 访问 http://localhost:3000
```

## 新增 Skill（扩展方式）

在 `backend/skills/` 下新建文件夹，添加两个文件：

```
skills/my-new-skill/
├── skill.yaml    # 声明元信息、工具权限、输入输出
└── prompt.md     # Claude System Prompt
```

重启后端，前端自动出现新 Skill，**无需改任何代码**。

## 架构说明

```
前端 (Next.js)
  ↕ HTTP + SSE
后端 (FastAPI)
  ├── Skill 管理    — 从文件系统加载，缓存到内存
  ├── Agent 引擎    — Claude tool_use 循环（核心）
  ├── 工具注册中心  — bash / file_write / file_read
  ├── 沙盒          — Docker 隔离执行（开发可关闭）
  └── 文件管理      — 任务级目录隔离 + TTL 清理
```

## 对应关注点

| 关注点 | 在本架构中的位置 |
|-----------|----------------|
| CC SDK 二开 | `services/agent.py` — tool_use 循环封装 |
| 文件管理 | `services/task_manager.py` — 三层目录 + TTL |
| 身份认证(KYC) | 预留：在 `api/tasks.py` 添加 auth middleware |
| 虚拟沙盒 | `services/sandbox.py` — Docker，生产加 gVisor |
| 报告输出 | `tools/registry.py` file_write + artifact_url |
