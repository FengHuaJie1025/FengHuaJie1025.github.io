---
title: "AI Agent：从概念到实战"
tags: ["AI Agent", "Agent", "LLM", "Agent 模式", "多 Agent", "CoA"]
date: 2026-07-05
summary: AI Agent 是 2025-2026 年 AI 领域最热的关键词。从 Agent 的定义、核心能力、设计模式到主流框架对比，再到多 Agent 协作与 CoA（Confirmation of Agent）评估标准，系统梳理这一方向的完整图景。 
draft: false
---

## 什么是 AI Agent

AI Agent（智能体）是一个能够**自主理解目标、制定计划、使用工具、执行行动并自我修正**的 AI 系统。它区别于普通对话模型的核心在于：**Agent 不是被动回答问题，而是主动完成任务。**

```
普通 LLM 对话：
用户输入 → LLM 生成回复 → 结束

Agent 模式：
用户输入目标 → LLM 分析意图
  → 制定计划 → 调用工具 → 获取结果
  → 评估进展 → 调整计划 → 继续执行
  → ...直到目标完成 → 输出最终结果
```

### Agent 的核心能力

| 能力 | 说明 | 依赖技术 |
|------|------|---------|
| **感知** | 理解用户意图、读取环境状态 | LLM 理解能力、Context 管理 |
| **规划** | 将目标分解为可执行的子任务 | Chain-of-Thought、ReAct |
| **决策** | 决定下一步做什么、用什么工具 | Function Calling、路由 |
| **执行** | 调用外部工具/API | Function Calling、MCP |
| **记忆** | 跨步骤保持状态，避免重复错误 | Memory 层、持久化 |
| **反思** | 评估结果，自我修正 | 验证循环、Critique |
| **停止** | 判断任务何时完成 | 终止条件检测 |

## Agent 的设计模式

### 模式 1：ReAct（Reasoning + Acting）

ReAct 是最基础也是最经典的 Agent 模式，核心是「思考→行动→观察」循环：

```
Thought: 用户想知道北京的天气，我需要查询天气 API
Action: get_weather(city="北京")
Observation: {"temp": 25, "condition": "晴"}

Thought: 获取到天气数据了，现在我可以回答用户
Final Answer: 北京今天 25°C，天气晴朗 ☀️
```

ReAct 模式下，LLM 每步输出「思考过程」和「行动指令」，宿主执行行动并返回「观察结果」，LLM 再基于观察继续思考。

### 模式 2：Plan-and-Execute

先制定完整计划，再逐步执行：

```
用户: "帮我研究 AI Agent 的最新进展，写一份报告"

Plan:
1. 搜索 "AI Agent 2026 最新进展"
2. 阅读前 5 篇文章的摘要
3. 搜索具体技术点（CoA、MCP、Multi-Agent）
4. 整理关键发现
5. 按模板撰写报告

Execute Step 1 → Step 2 → Step 3 → Step 4 → Step 5
```

**优势**：计划阶段一次性消耗 Token，执行阶段无需反复规划，效率更高。**劣势**：计划可能不准确，遇到意外需要重新规划。

### 模式 3：Plan-and-Solve

Plan-and-Execute 的改进版：每一步执行后可以修正后续计划。

```
Step 1: 搜索 "AI Agent 最新进展" → 发现搜索结果偏技术新闻而非论文
修正计划: 补充学术搜索 "AI Agent research 2026"
Step 2: 搜索学术论文 → 找到 3 篇高质量论文...
修正计划: 重点阅读论文 A 和 C
...
```

### 模式 4：Tool-Use Agent（工具驱动的 Agent）

这是当前 Claude Code、Cursor 等产品中的主流模式：

```
用户: "修复这个 bug"

Agent 循环:
  1. Read bug report → 理解问题
  2. grep 搜索相关代码 → 定位文件
  3. Read 源文件 → 理解逻辑
  4. Write 修复代码
  5. Run tests → 验证
  6. 如果测试失败 → 回到 3（自我修正）
  7. Commit + PR
```

### 模式 5：Multi-Agent 协作

多个专业 Agent 分工协作：

```
             ┌─── 协调者 Agent ───┐
             │  分解任务、分配、汇总 │
             └──┬──┬──┬──┬──┬──┬──┘
                │  │  │  │  │  │
  ┌────┐ ┌────┐ │┌────┐│ ┌────┐ ┌────┐
  │搜索│ │编码│ ││测试││ │审查│ │部署│
  │Agent│ │Agent│ ││Agent││ │Agent│ │Agent│
  └────┘ └────┘ │└────┘│ └────┘ └────┘
                │  │  │  │  │  │
              ┌──┴──┴──┴──┴──┴──┴──┐
              │   验证 Agent         │
              │  （Maker/Checker 分离）│
              └─────────────────────┘
```

**核心原则**：写代码的 Agent（Maker）和检查代码的 Agent（Checker）必须分离，用不同的模型或实例。

## 主流 Agent 框架对比

| 框架 | 特点 | 适用场景 | 模型支持 | 学习曲线 |
|------|------|---------|---------|---------|
| **Claude Code** | 原生 Agent，CLI 优先，Skill/Loop/Goal | 编码、DevOps、自动化 | Claude 系列 | 低 |
| **LangChain Agent** | 框架式，生态丰富 | 复杂应用，需深度定制 | 多模型 | 中高 |
| **AutoGen** | 多 Agent 对话，微软出品 | 多 Agent 协作 | 多模型 | 中 |
| **CrewAI** | 角色化 Agent，简单直观 | 任务派发、团队协作 | 多模型 | 低中 |
| **Semantic Kernel** | .NET/Java 原生，微软 | 企业应用集成 | Azure OpenAI 为主 | 中 |
| **OpenAI Agents SDK** | 轻量，官方 | 快速原型 | OpenAI | 低 |
| **Dify Agent** | 可视化配置 | 非开发者构建 Agent | 多模型 | 低 |

## CoA：Agent 成熟度评估框架

CoA（Confirmation of Agent）是一个评估 Agent 系统成熟度的框架，从五个维度评估：

### L0：无 Agent

纯对话模型，无工具调用，无自主能力。

### L1：工具辅助

- 可以调用预定义工具
- 工具调用由人工触发或简单规则触发
- 无自主规划能力
- 示例：用 Function Calling 做简单查询

### L2：自主 Agent

- 能自主分解任务、制定计划
- 能自主选择工具并决定调用时机
- 有基本的错误处理和重试
- 能保持多步记忆
- 示例：Claude Code 修复 bug

### L3：高级 Agent

- Maker/Checker 分离，有验证 Agent
- 能反思失败并调整策略
- 支持长周期任务（数小时到数天）
- 有持久化记忆（跨 session）
- 示例：带 CI Triaging 和自动修复的 Loop

### L4：多 Agent 协作

- 多个专业 Agent 分工协作
- 有协调者/路由 Agent
- Agent 间可互相通信和验证
- 支持动态 Agent 创建和销毁
- 示例：编码 Agent + 测试 Agent + 审查 Agent + 部署 Agent

### L5：自适应 Agent 生态

- Agent 可自我优化和进化
- 自动发现新工具并学习使用
- 跨项目/组织共享经验和技能
- 人机协作边界动态调整
- 示例（理想态）：AI 研发团队自主迭代产品

## Agent 的陷阱

### 1. 无限循环

没有合理的终止条件，Agent 可能在同一个问题上反复打转。

**解决**：设置最大迭代次数、引入验证 Agent、检测重复模式。

### 2. Token 爆炸

Agent 每轮决策都消耗大量 Token，复杂任务可能产生数十万 Token 的调用链。

**解决**：精简工具定义、压缩上下文、设置 Token 预算上限。

### 3. 幻觉放大

Agent 的每个错误决策会被后续步骤放大——一步错，步步错。

**解决**：关键步骤加入验证、设置 checkpoints、Maker/Checker 分离。

### 4. 工具选择错误

Agent 选择了错误的工具或传入了错误的参数。

**解决**：工具描述要精准、参数要有约束（enum/min/max）、加入工具使用示例。

### 5. 理解债（Comprehension Debt）

Agent 产出越多，开发者对系统的理解越少。

**解决**：强制审查关键变更、保留人工审批路径、定期做代码审计。

## 构建 Agent 系统的建议

### 从最简单开始

```python
# 最简单的 Agent 循环
def simple_agent(task: str, tools: list, max_steps: int = 10):
    messages = [{"role": "user", "content": task}]
    
    for step in range(max_steps):
        response = llm.chat(messages, tools=tools)
        
        if response.finish_reason == "stop":
            return response.content
        
        # 执行工具调用
        for tool_call in response.tool_calls:
            result = execute_tool(tool_call)
            messages.append(tool_call_message(tool_call, result))
    
    return "任务未在最大步骤内完成"
```

### 渐进式增强路线

```
Step 1: 单 Agent + 2-3 个工具          → 验证基础能力
Step 2: 增加错误处理和重试              → 提升可靠性
Step 3: 增加验证 Agent（Checker）       → 提升质量
Step 4: 增加持久化记忆                  → 跨 session 学习
Step 5: 增加到 Planner Agent            → 复杂任务分解
Step 6: 增加专业工具 Agent              → 多 Agent 协作
```

## 展望

Agent 是 LLM 能力的放大器。2024-2026 年的进展表明：

- **单 Agent 已经可以完成大部分编码任务**（修复 bug、写测试、重构）
- **多 Agent 协作正在解决更复杂的问题**（跨模块开发、系统设计）
- **验证和安全性是 Agent 走向生产的关键瓶颈**
- **人类在 Agent 系统中的角色正在从「操作者」变为「监督者」**

这不是 AI 取代人，而是 AI 让人可以关注更重要的事情。