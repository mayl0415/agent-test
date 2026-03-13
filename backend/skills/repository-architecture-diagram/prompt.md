---
name: github-repo-architecture-diagram
description: 分析 GitHub 仓库结构并生成 draw.io 架构图
---

# GitHub 仓库架构图分析

当用户希望分析 GitHub 项目的代码结构并生成架构图时，使用该能力。

例如用户请求：

- 分析某个 GitHub 项目的代码结构
- 生成项目模块架构图
- 可视化模块依赖关系

---

# 执行流程

## Step 1 获取仓库

根据用户提供的 GitHub 仓库地址：

- 克隆仓库
- 或读取仓库文件结构

重点关注：

- src
- packages
- modules
- services
- scripts
- config

---

## Step 2 探索项目结构

生成简化目录结构，例如：

create-react-app  
├ packages  
│ ├ create-react-app  
│ ├ react-scripts  
│ └ cra-template  
├ scripts  
├ docs  
└ test  

识别主要模块。

---

## Step 3 读取关键文件

重点分析：

配置文件：

- package.json
- pom.xml
- build.gradle
- requirements.txt

入口文件：

- index.js
- main.ts
- CLI入口

文档：

- README.md
- architecture.md
- design.md

---

## Step 4 推断系统架构

根据项目结构推断模块关系，例如：

CLI  
↓  
核心模块  
↓  
构建系统  

形成简化架构模型。

---

# Step 5 生成 draw.io XML

根据架构模型生成 **标准 draw.io XML**。

必须符合以下规范：

## 1 根节点结构

XML 必须使用：

```

<mxfile>
  <diagram>
    <mxGraphModel>
```

并包含：

```
<root>
  <mxCell id="0"/>
  <mxCell id="1" parent="0"/>
</root>
```

---

## 2 节点定义

模块节点使用：

```
<mxCell
  id="node_id"
  value="模块名称"
  style="rounded=1;whiteSpace=wrap;html=1;"
  vertex="1"
  parent="1">
  <mxGeometry x="X" y="Y" width="W" height="H" as="geometry"/>
</mxCell>
```

要求：

* 使用 `vertex="1"`
* 使用 `rounded=1`
* `value` 为模块名称

---

## 3 连接关系

模块之间使用 edge：

```
<mxCell
  id="edge_id"
  edge="1"
  source="source_id"
  target="target_id"
  parent="1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

---

## 4 XML 兼容 HTML 渲染

生成的 XML 必须：

* 完整合法
* 不包含非法字符
* 可以被 HTML 转义后嵌入 `data-mxgraph` 属性
* 不在 XML 注释中使用 `--`

特殊字符需可转义：

```
<  → &lt;
>  → &gt;
"  → &quot;
```

---

# 输出内容

最终输出：

1️⃣ 项目结构说明
2️⃣ 架构模块说明
3️⃣ draw.io XML（完整 `<mxfile>`）