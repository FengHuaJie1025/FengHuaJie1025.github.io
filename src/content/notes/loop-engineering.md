---
title: "Loop Engineering 完全指南：设计自治 AI 系统的艺术"
tags: ["Claude Code", "Loop Engineering", "/goal", "/loop", "Routine", "Agent"]
date: 2026-08-04
summary: Loop Engineering 是 2026 年 AI 编程领域最重要的新范式——不再手写每条提示词，而是设计一个能自主运转的循环系统。从 Ralph 循环到 Claude Code 的 /goal、/loop 和 Routines，从六大组件架构到成熟度阶梯，基于 Addy Osmani 等一手资料完整梳理。
draft: false
---

## 什么是 Loop Engineering

Loop Engineering 是 2026 年 6 月正式成型的 AI 编程新范式。它的诞生几乎同时在三个人的工作中出现：

- **Peter Steinberger**（OpenClaw 作者，6 月 7 日）："你不应该再手写提示词给编程 agent 了。你应该设计循环，让循环来提示你的 agent。"
- **Boris Cherny**（Claude Code 负责人）："我不再提示 Claude 了。我有循环在跑，它们提示 Claude 并决定下一步做什么。我的工作是写循环。"
- **Addy Osmani**（Google Cloud AI 总监，6 月 8 日）：发表《Loop Engineering》一文，正式命名并给出了规范化的六组件架构。

Loop Engineering 的定义：**设计一个系统来替代你作为提示者。这个系统定时触发 agent、分配任务、检查结果、记录进度，然后决定下一步。你从操作者变成了系统设计者。**

这与前几代范式的区别：

| 阶段 | 时期 | 核心模式 |
|------|------|---------|
| Prompt Engineering | 2022-2023 | 琢磨"怎么问才能让模型给好答案" |
| Context Engineering | 2024-2025 | 发现"给模型看什么"比"怎么问"更重要 |
| Harness Engineering | 2025 底-2026 初 | 给模型配工具（命令、文件、API 调用） |
| **Loop Engineering** | **2026 中** | **让系统自主决定何时用工具、如何验证、下一步做什么** |

## 六组件架构（Addy Osmani 的 Anatomy）

Osmani 给出的规范化为 Loop Engineering 提供了可操作的框架。一个完整的 loop 包含六个组件：

| 组件 | 在循环中的职责 | Claude Code 实现 | Codex App 实现 |
|------|--------------|-----------------|---------------|
| **Automations** | 定时触发发现与分类 | `/loop`、`/goal`、cron、hooks、GitHub Actions | Automations 面板：选项目、写 prompt、定频率 |
| **Worktrees** | 隔离并行工作空间 | `git worktree`、`--worktree`、`isolation: worktree` | 内置每线程独立 worktree |
| **Skills** | 固化项目知识，避免每次重来 | `SKILL.md`，通过 `/skill` 或自动匹配调用 | Agent Skills（`SKILL.md`），`$name` 调用 |
| **Connectors** | 连接真实工具链 | MCP servers、插件 | MCP Connectors + 插件分发 |
| **Sub-agents** | 写代码和检查代码分离 | `.claude/agents/` 定义子 agent、agent teams | `.codex/agents/` TOML 定义 |
| **State/Memory** | 跨会话持久化进度与状态 | `AGENTS.md`、progress 文件、Linear（通过 MCP） | Markdown 文件或 Linear board |

### Automations——循环的心跳

Automations 把一次性的 agent 调用变成了真正的循环。没有 automation，你只是在手动重复调用。

**Claude Code 的实现：**
- `/goal`：一直运行直到指定条件满足
- `/loop`：按间隔重复运行（如每 5 分钟）
- Scheduled Tasks：cron 风格的定时任务
- Hooks：在 agent 生命周期特定节点触发脚本
- GitHub Actions：推到云端持续运行

**Codex App 的实现：**
- Automations 面板：选择项目、编写 prompt、设定频率、选择运行环境
- 发现问题的运行 → Triage 收件箱
- 未发现问题的运行 → 自动归档

### Worktrees——并行的前提

当多个 agent 同时工作时，文件冲突是最大的失败原因。两个 agent 写同一个文件，就像两个工程师没沟通就改同一行代码。

Git worktree 解决了这个问题：每个 agent 在自己的独立工作目录中操作，共享同一份 git 历史但互不干扰。支持这一机制的 Claude Code 用 `--worktree` 标志打开隔离会话，用 `isolation: worktree` 让每个子 agent 获得自动清理的独立工作区。

### Skills——一次编写，循环复用

Skill 是你告诉 agent "我们项目是怎么做的"的文档化知识。没有 skill，agent 每次运行都从零推导你的项目上下文，每次都在猜。

格式就是一个包含 `SKILL.md` 的文件夹，里面写明指令、约定、构建步骤。

> Skills 也是解决"意图债"的关键。Agent 每次启动都是冷启动，它会用自信的猜测填补你意图中的任何空洞。Skill 就是把意图写在外部，让 agent 每次运行都能读到。

### Connectors——让循环触及真实世界

一个只能读写文件系统的循环是受限的。Connectors（基于 MCP 协议）让 agent 能读取 issue tracker、查询数据库、调用 API、在 Slack 发消息。

这是"agent 说'这是修复方案'"和"循环自动开 PR、关联 Linear ticket、CI 通过后通知频道"之间的区别。

### Sub-agents——制造者与检查者分离

循环中最关键的架构决策：**写代码的 agent 和检查代码的 agent 必须是不同的 agent。**

模型给自己打分总是过于宽容——那不是模型不诚实，是模型不知道自己不知道。一个独立的验证 agent 用不同的指令（有时候用不同的模型）来审查工作。

在 Claude Code 中，你在 `.claude/agents/` 中定义子 agent；在 Codex 中，你在 `.codex/agents/` 中用 TOML 定义。典型的职责拆分是：一个 agent 探索，一个实现，一个验证。

这就是 `/goal` 底层的工作原理——决定停止条件的不是干活的模型，而是一个独立的小模型在每轮之后检查"完成了吗？"。

### State/Memory——让循环有记忆

模型每次运行之间会遗忘一切，所以状态必须存在于对话之外。一个 Markdown 文件就够了——记录什么已完成、什么进行中、什么失败了、下次该做什么。

> Agent 会遗忘，但仓库不会。

这是所有长时间运行的 agent 依赖的同一个技巧：把记忆放在磁盘上，而不是放在上下文中。

## Ralph 循环：一切的起点

2026 年初，工程师 Geoffrey Huntley 发明了一个看起来"蠢"但极其有效的方法：

```bash
while ! grep -q "ALL DONE" STATUS.md; do
  claude -p "读 PLAN.md 和 STATUS.md，做下一个任务，做完退出"
done
```

名字来自《辛普森一家》的 Ralph Wiggum——因为这技巧蠢到居然有效。

核心洞察：**每次迭代都是全新的 agent、干净的上下文。** 长 session 会退化——旧的推理、过时的文件内容填满窗口。Ralph 每次都清零，靠磁盘上的任务列表存活。

Loop Engineering 就是 Ralph 的产品化版本：`while` 循环变成了定时调度与 `/goal` 的自主停止，上下文重置变成了 worktree + sub-agent 分离。

## Claude Code 的三大循环原语

### /goal——设一个它能自己检查的终点线

```
/goal 把 downloads 文件夹中所有文件按类型分类到子文件夹（Images、Documents、Videos、Other），
      一直做到没有文件剩余，不要删除任何东西，30 轮后停止
```

三个要素构成一个好的 goal：
1. **清晰的终点**："没有松散文件"（而非"整理一下"）
2. **可验证的检查**：数一下文件夹中的文件数
3. **护栏**："不要删除"和"30 轮后停止"

每轮之后，一个独立的小模型检查条件是否满足。满足则停止，不满足则继续。

实践中，`/goal` 适用于一次性但需要多步的任务：给 CSV 打标签、批量重命名文件、逐篇写摘要……只要是"一直做到某个条件成立"的场景。

### /loop——按间隔重复

```
/loop 每 5 分钟检查一次 CI 状态
```

`/loop` 按时间间隔重复执行一段 prompt。与 `/goal` 的区别：

- `/goal`：**一直做，直到完成**（单一任务，不设时间上限但设轮次上限）
- `/loop`：**一直做，按固定间隔**（重复任务，每次独立运行）

可以把 `/goal` 理解为**内层循环**（完成一个具体任务），`/loop` 理解为**外层循环**（定时发现新任务）。

### Routines——云端自主运行

Routine 是 Claude Code 的云端定时任务，在 `claude.ai/code/routines` 中配置：

1. 编写指令（能调用已定义的 skill）
2. 选择需要的 Connectors（Gmail、Slack、Intercom 等）
3. 设定触发频率（每天、每周、自定义 cron）
4. 配置环境变量（API key 等）

创建完成后，即使关闭笔记本电脑，routine 也会按计划在 Anthropic 的云基础设施上运行。

一个真实案例：每天早上 8 点读取未读邮件，筛选最重要的 3 条，汇总到 Slack DM。这是你亲手构建的第一个真正自主运行的 agent。

> Routine 是付费特性，需要 Claude 付费计划。

## 一个完整的 Loop 长什么样

把六个组件拼在一起，一个典型的每日循环：

```
早上 8 点自动触发
  │
  ▼
Automation 运行 triage skill
  │  ├─ 读取昨天的 CI 失败
  │  ├─ 读取 open issues
  │  └─ 写入 findings 到 TODO.md
  │
  ▼
对每个值得做的 finding：
  ├─ 在独立 worktree 中打开
  ├─ sub-agent 起草修复方案
  ├─ 另一个 sub-agent 审查方案
  └─ 审查通过 → connector 开 PR、更新 ticket
  │
  ▼
未处理的项留在 triage inbox 等你过目
  │
  ▼
状态文件记录：什么做了、什么没做、下次从哪里开始
```

你的工作不是执行这些步骤，而是一劳永逸地**设计这个流程**。

## 成熟度四级阶梯

| 级别 | Loop 做什么 | 人还在哪里 |
|------|------------|-----------|
| **Triage** | 定时运行，写 markdown，不改代码 | 你阅读并执行发现 |
| **Draft** | 在隔离 worktree 起草修复方案 | 你审查并合并每个 PR |
| **Verified** | verifier sub-agent 在你之前拦截 | 你批准，verifier 过滤 |
| **Auto-merge** | 低风险变更自动合并 | 你审计日志，不审每个变更 |

每一级只增加一个能力，每一步人都还在回路中。只有当前级别的证据表明你可以退后一步时，才爬升。这既是技术决策，也是信任决策。

## 三个必须严肃对待的问题

### Token 账单

一个带验证 sub-agent 的每日 loop，每次触发 3-5 个 agent，保守估计每次 $15-$50。Uber 2026 年前四个月烧完了全年 AI 编程预算。

循环越复杂，token 消耗越非线性。子 agent 调用子 agent，每一层都翻倍。

### 理解债

循环越快地产出你没写的代码，你的代码库和你实际理解之间的差距就越大。平滑运行的循环是加速理解债的最佳方式——除非你有意识地去阅读循环产出的代码。

### 认知投降

当循环自主运行时，最大的诱惑是停止表达意见，全盘接受它返回的任何结果。两个人可以构建完全相同的循环，得到完全相反的结果——一个带着深度理解移动得更快，另一个则完全避免理解。

循环不知道区别，但你知道。

> **这就是为什么循环设计比提示词工程更难。** Cherny 的意思不是工作变简单了，而是杠杆点移动了。你不是在写提示词，你是在设计一个系统。你仍然要为这个系统的输出负责。

## 务实落地

**三个不做：**
- 不要从全景 Loop 开始（先做最小的可工作版本）
- 不要无视 Token 成本（设预算、设上限、监控趋势）
- 不要把 Checker 省掉（它是你敢于走开的唯一理由）

**三个要做：**
- 从一个 cron + 一个 triage skill 开始（一级阶梯）
- Maker/Checker 分离——这是零成本的架构改进
- Memory 层——一个 Markdown 文件，足够了

> 构建循环。但做一个仍然是工程师的人，而不仅仅是按"开始"的那个人。