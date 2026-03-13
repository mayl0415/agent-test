Agent 平台 — 产品说明                                     
                                                                                                                                  
  是什么                     
                                                                                                                                  
  Agent 平台是一个基于 Claude Code SDK 的 AI 自动化执行平台。用户上传文件、选择一个预定义的 Skill（技能），平台会驱动 AI Agent
  自主完成分析、编写代码、执行代码、生成报告的全流程，并将过程实时展示在界面上。

  典型使用场景：上传一份 CSV 数据 → 选择"数据可视化分析" → 几分钟后得到一份完整的交互式 HTML 分析报告。

  ---
  核心原理

  整体架构

  用户浏览器
     │  上传文件 + 选 Skill
     ↓
  Next.js 前端
     │  HTTP POST 创建任务
     ↓
  FastAPI 后端
     │  启动 Agent 后台任务
     │  SSE 实时推送事件流 ──→ 前端实时渲染
     ↓
  Claude Code SDK
     │  驱动 claude CLI 子进程
     ↓
  Anthropic API (Claude Sonnet)
     │  模型规划 → 调用工具 → 得到结果 → 继续规划…
     ↓
  工具执行层
     Write（写文件）/ Bash（执行命令）/ Read（读文件）

  Agent 执行循环

  Agent 并不是简单地"生成文本"，而是在一个工具调用循环里工作：

  1. 模型思考：Claude 读取任务说明和文件信息，规划步骤
  2. 调用工具：决定用哪个工具（写 Python 脚本、执行脚本、写 HTML 报告…）
  3. 等待结果：工具执行完毕，结果返回给模型
  4. 继续规划：模型看到执行结果，决定下一步
  5. 重复直到任务完成

  这个循环完全自主——模型自己决定写什么代码、执行什么命令、如何处理错误。

  实时流式展示（SSE）

  任务执行过程通过 Server-Sent Events（SSE） 实时推送到前端，事件类型包括：

  ┌────────────────┬──────────────────┐
  │      事件      │       含义       │
  ├────────────────┼──────────────────┤
  │ agent_text     │ 模型的思考文字   │
  ├────────────────┼──────────────────┤
  │ step_start     │ 开始调用一个工具 │
  ├────────────────┼──────────────────┤
  │ step_done      │ 工具执行完毕     │
  ├────────────────┼──────────────────┤
  │ artifact_ready │ 产物文件已生成   │
  ├────────────────┼──────────────────┤
  │ task_done      │ 任务全部完成     │
  └────────────────┴──────────────────┘

  前端根据事件类型，在左侧面板实时展示"模型思考文字 + 工具调用 chip"，在右侧面板展示代码内容、控制台输出、或最终报告预览。

  Skill 机制

  每个 Skill 是一个独立的 AI 专家角色定义，存放在 backend/skills/{skill-id}/ 目录下：

  skills/
    data-viz/
      skill.yaml    # 元信息：名称、图标、支持的工具、输入类型
      prompt.md     # System Prompt：定义 Agent 的工作流和行为规范
    doc-reader/
      skill.yaml
      prompt.md

  skill.yaml 定义接口：

  id: data-viz
  name: 数据可视化分析
  icon: 📊
  tools: [bash, file_write, file_read]
  input:
    - type: file
      accept: [.csv, .xlsx]
      label: 上传数据文件
      required: true

  prompt.md 定义行为——它是发给 Claude 的 System Prompt，决定 Agent 采用什么工作流、遵守什么约束。

  ---
  如何扩展：新增一个 Skill

  扩展成本极低，只需新建两个文件，无需修改任何后端代码。

  第一步：新建目录和 skill.yaml

  # backend/skills/sql-analyst/skill.yaml
  id: sql-analyst
  name: SQL 数据分析
  description: 上传数据库导出文件，自动生成 SQL 分析报告
  icon: 🗄️
  tags: [SQL, 数据分析]
  tools: [bash, file_write, file_read]
  output: SQL 分析 HTML 报告
  input:
    - type: file
      accept: [.sql, .csv, .db]
      label: 上传数据文件
      required: true
    - type: text
      label: 分析重点（可选）
      required: false

  第二步：编写 prompt.md，定义工作流

  # SQL 数据分析 Agent

  你是一名专业的数据库分析师…

  ## 工作流程
  1. 用 Write 写 explore.py，用 Bash 执行，了解数据结构
  2. 用 Write 写 analysis.py，用 Bash 执行，进行统计分析
  3. 用 Write 生成 report.html（Chart.js 可视化）

  ## 约束
  - 先 Write 写 .py 文件，再 Bash 执行，禁止内联执行
  - 报告写入：{output_dir}/report.html

  重启后端，新 Skill 自动出现在界面上。

  ---
  沙箱：隔离与安全

  当前实现

  目前平台运行在用户级隔离模式：

  - Agent 以 claude-agent 低权限用户身份运行（非 root）
  - 每个任务有独立的 workspace 目录，互相隔离
  - Claude Code SDK 设置 permission_mode="bypassPermissions"（允许所有工具，适合受信任环境）
  - 产物通过 API 提供访问，不直接暴露文件系统

  升级到 Docker 沙箱

  对于生产环境或多租户场景，推荐将每个任务的 Bash 执行放入 Docker 容器：

  方案一：替换 Bash 工具为容器执行

  在 SDK options 里指定沙箱镜像：
  # ClaudeCodeOptions 支持通过 env 和 cwd 控制执行环境
  # 可在工具层拦截 Bash 调用，改为 docker run
  options = ClaudeCodeOptions(
      allowed_tools=["Bash", "Write", "Read"],
      cwd=str(workspace),
      permission_mode="bypassPermissions",
      env={
          "DOCKER_IMAGE": "python:3.12-slim",
          "DOCKER_WORKSPACE": str(workspace),
      }
  )

  方案二：使用 claude CLI 的 --sandbox 模式（如果版本支持）

  # SDK 透传到 claude CLI
  options = ClaudeCodeOptions(
      ...
      # 部分版本支持传递沙箱配置
  )

  方案三：自定义 Transport 层

  SDK 的 SubprocessCLITransport 可以被替换，实现自定义的容器化执行：

  from claude_code_sdk._internal.transport import Transport

  class DockerTransport(Transport):
      """把 claude CLI 运行在 Docker 容器里"""
      async def connect(self):
          self._process = await anyio.open_process(
              ["docker", "run", "--rm", "-v", f"{workspace}:/workspace",
               "--network=none",  # 禁止网络
               "--memory=512m",   # 内存限制
               "my-claude-sandbox",
               "claude", "--print", "--output-format", "stream-json", ...],
          )

  沙箱关键能力矩阵

  ┌──────────────────────┬──────────┬──────────────────────┐
  │         能力         │   当前   │     Docker 沙箱      │
  ├──────────────────────┼──────────┼──────────────────────┤
  │ 文件系统隔离         │ 目录级   │ 容器级 ✓             │
  ├──────────────────────┼──────────┼──────────────────────┤
  │ 网络隔离             │ ✗        │ --network=none ✓     │
  ├──────────────────────┼──────────┼──────────────────────┤
  │ CPU/内存限制         │ ✗        │ cgroups ✓            │
  ├──────────────────────┼──────────┼──────────────────────┤
  │ 进程隔离             │ 用户权限 │ 容器 PID namespace ✓ │
  ├──────────────────────┼──────────┼──────────────────────┤
  │ 镜像自定义（预装包） │ 手动安装 │ Dockerfile 管理 ✓    │
  └──────────────────────┴──────────┴──────────────────────┘

  ---
  技术栈总览

  ┌──────────┬───────────────────────────┬────────────────────────────┐
  │    层    │           技术            │            说明            │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ 前端     │ Next.js 14 App Router     │ SSE 消费、实时渲染         │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ 后端     │ FastAPI + Python          │ 任务管理、SSE 推送         │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ AI 驱动  │ Claude Code SDK           │ 封装 claude CLI 子进程     │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ 模型     │ Claude Sonnet (Anthropic) │ 规划 + 工具调用            │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ 持久化   │ SQLite (aiosqlite)        │ 任务历史，重启恢复         │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ 产物存储 │ 本地文件系统              │ 按 task_id 隔离目录        │
  ├──────────┼───────────────────────────┼────────────────────────────┤
  │ 实时通信 │ Server-Sent Events        │ 单向推送，天然适合流式任务 │
  └──────────┴───────────────────────────┴────────────────────────────┘

  ---
  扩展路线图（可选方向）

  - 更多 Skill：PPT 生成、代码审查、合同分析、图片处理…
  - Docker 沙箱：生产级隔离，支持多租户
  - 任务队列：Redis + Celery，支持并发任务和排队
  - 自定义工具：在 SDK 基础上注册领域专用工具（调用内部 API、读数据库…）
  - 多轮会话：追问功能已实现，可扩展为完整对话历史
  - Webhook 回调：任务完成后通知外部系统