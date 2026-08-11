---
title: "Dify：LLM 应用开发平台深度解析"
tags: ["Dify", "LLM", "RAG", "AI 平台", "Workflow", "Agent"]
date: 2026-06-15
summary: Dify 是一个开源的 LLM 应用开发平台，提供可视化 Workflow 编排、RAG 管线、Agent 模式、模型管理等能力。本文深入拆解其核心架构与实战用法。
draft: false
---

## 什么是 Dify

Dify 是一个**开源**的 LLM 应用开发与运维平台（GitHub 40k+ stars），定位介于「直接调用 API」和「企业级 AI 平台」之间。它提供可视化界面来编排 Prompt、管理知识库、构建工作流，同时保留了代码层面的扩展能力。

核心价值：**把 LLM 应用的常见基础设施（模型路由、Prompt 管理、RAG、日志、监控）打包成开箱即用的平台服务。**

## 核心架构

```
用户层 (Web App / API / 嵌入)
    │
应用层 ──┬── 对话型 Chatbot
         ├── Agent (ReAct / Function Call)
         ├── Workflow (可视化编排)
         └── 批处理 / 文本生成
    │
能力层 ──┬── RAG 管线 (文档解析 → 分块 → Embedding → 检索)
         ├── 工具/插件系统
         ├── 变量/知识库/上下文管理
         └── 模型路由与负载均衡
    │
模型层 ──┬── OpenAI / Anthropic / DeepSeek / 通义千问
         ├── Ollama (本地模型)
         └── HuggingFace / Replicate / 自定义
```

## 核心功能详解

### 1. 应用类型

Dify 支持三种应用模式：

| 模式 | 适用场景 | 特点 |
|------|---------|------|
| Chatbot | 客服、问答、对话助手 | 简单对话，支持上下文记忆 |
| Agent | 需调用工具/API 的复杂任务 | ReAct 或 Function Call 模式 |
| Workflow | 多步骤编排、批处理 | 可视化 DAG，支持条件/循环/并行 |

### 2. Workflow 编排

Dify 的 Workflow 是最强大的功能之一。它是一个可视化的 DAG（有向无环图）编辑器，节点包括：

- **LLM 节点**：调用模型，可配置 System Prompt 和变量
- **知识检索节点**：从知识库检索相关内容
- **代码节点**：执行 Python/JS 代码做数据转换
- **HTTP 请求节点**：调用外部 API
- **条件分支**：if/else 逻辑
- **变量聚合**：多路结果合并
- **迭代循环**：列表逐项处理
- **答案节点**：输出最终结果

实战示例——自动客服工作流：

```
用户输入
  │
  ▼
分类节点 (LLM 判断意图: 退货/查询/投诉)
  │
  ├── 退货 → 知识检索 (退货政策) → LLM 生成回复 → 创建工单 → 输出
  ├── 查询 → 调用订单 API → LLM 组织回复 → 输出
  └── 投诉 → 转人工 → 记录投诉 → 输出
```

### 3. RAG 知识库

Dify 的知识库支持完整的 RAG 管线：

**文档处理**：
- 格式支持：PDF、TXT、Markdown、HTML、DOCX、Excel
- 分块策略：段落分割 / 固定长度 / 自定义分隔符
- 预处理：清洗 HTML、去重、实体识别增强

**检索增强**：
- 检索策略：向量相似度 / 全文搜索 / 混合检索
- 重排序：支持 Cohere Rerank 等模型提升精度
- 引用标注：自动在答案中标注来源文档

**知识库管理**：
- 多知识库隔离（不同业务线/权限）
- 批量更新与同步
- API 接口做实时索引

### 4. Agent 模式

Dify Agent 使用 ReAct 或 Function Call 模式，内置工具市场：

- **内置工具**：网页搜索、网页抓取、代码执行、图像生成
- **自定义 API 工具**：通过 OpenAPI/Swagger 规范导入
- **插件系统**：社区贡献的插件生态

Agent 配置核心参数：

| 参数 | 说明 |
|------|------|
| 迭代上限 | Agent 最大思考-行动循环次数 |
| 工具选择 | 允许/禁止 Agent 自动选择工具 |
| 记忆窗口 | 保留多少轮历史对话 |
| Prompt 模板 | Agent 系统提示词模板 |

### 5. 模型管理与路由

- **多模型配置**：同一应用可配置多个模型做 fallback
- **负载均衡**：多个 API Key 轮询分摊配额
- **模型参数**：Temperature、Top-P、Max Tokens 按需调整
- **自定义模型**：支持接入任意兼容 OpenAI 格式的 API

## 部署方式

```bash
# Docker 部署（官方推荐）
git clone https://github.com/langgenius/dify.git
cd dify/docker
cp .env.example .env
docker compose up -d

# 访问 http://localhost:3000
```

或者通过 Dify Cloud 直接使用托管版本（有免费额度）。

## 实用技巧

### 变量系统

Dify 的变量是整个平台最灵活的机制：

```
{{#sys.query#}}         — 用户当前输入
{{#context.knowledge#}} — 知识库检索结果
{{#memory.history#}}    — 对话历史
{{sys.files}}           — 用户上传的文件
```

自定义变量可以在 Workflow 节点间传递，实现复杂状态管理。

### Prompt 模板管理

```yaml
# 可导入/导出的 Prompt 配置
system_prompt: |
  你是一名{{role}}，请用{{tone}}的语气回答。
  参考以下知识库内容：
  {{#context.knowledge#}}
  
variables:
  - variable: role
    type: select
    options: [客服, 技术支持, 销售]
  - variable: tone
    type: select
    options: [专业, 亲切, 简洁]
```

### 日志与观测

- 完整会话日志（含中间步骤截图）
- Token 消耗统计与趋势
- 人工标注反馈（赞/踩）
- 导出日志做离线评估

## 与竞品对比

| 特性 | Dify | LangFlow | Coze | FastGPT |
|------|------|----------|------|---------|
| 开源 | ✅ | ✅ | ❌ | ✅ |
| 可视化 Workflow | ✅ | ✅ | ✅ | 有限 |
| Agent 模式 | ✅ | 有限 | ✅ | ❌ |
| 知识库 RAG | ✅ | ❌ | ✅ | ✅ |
| 自部署 | ✅ | ✅ | ❌ | ✅ |
| 插件生态 | 发展中 | ❌ | 丰富 | 有限 |
| 企业级功能 | 基础版 | ❌ | ✅ | 基础版 |

## 适用场景

- **快速原型**：拖拽搭建 LLM 应用 MVP，几天内验证想法
- **知识库问答**：内部文档、产品手册、客服知识库
- **自动化工作流**：审批辅助、数据提取与转换、报告生成
- **Agent 应用**：需要调用多工具的复杂任务编排

Dify 的核心哲学是**把 AI 应用的开发从编码降级为配置**，让非技术成员也能参与到 AI 应用构建中。