---
title: "AI 编程效率工具链：从 Claude Code 到 Cursor 的完整装备指南"
tags: ["AI 编程", "Claude Code", "Cursor", "Copilot", "工具链", "开发效率"]
date: 2026-06-06
summary: 从 Claude Code 的完整命令手册到 Cursor的使用，帮你搭建高效的 AI 编程工作流。
draft: false
---

## 为什么需要 AI 编程工具

程序员每天大量时间在重复性工作上：写 boilerplate、调试报错、读文档、写测试、翻译代码。这些任务有一个共同特征：**需要理解上下文，但不需要创造性决策。** 正好是 AI 最擅长的部分。

2026 年的 AI 编程工具已经不只是"补全代码"了——它们能读你的整个项目、理解架构、自主修复 bug、写测试、开 PR。选对工具，一天能省出两三个小时。

---

## 一、Claude Code：CLI 里的 AI 工程师

Claude Code 是目前功能最完整的 AI 编程工具，运行在终端里，能读写文件、执行命令、操作 Git。

### 核心概念

```
你输入自然语言指令
    │
    ▼
Claude Code 理解意图
    │
    ├─ 需要读代码？→ 用 Glob/Grep/Read 工具
    ├─ 需要改代码？→ 用 Edit/Write 工具
    ├─ 需要验证？→ 运行测试/构建命令
    └─ 需要探索？→ 自主决策下一步
```

### Slash Command 速查表

| 命令 | 作用 | 常用场景 |
|------|------|---------|
| `/clear` | 清空对话历史 | 重新聚焦、清理上下文 |
| `/compact` | 压缩对话历史 | 上下文过长时节省 Token |
| `/cost` | 查看本次对话 Token 消耗 | 成本控制 |
| `/login` | 登录 Anthropic 账号 | 使用付费模型 |
| `/model` | 切换模型 | 简单任务用小模型、复杂任务用大模型 |
| `/reasoning` | 开启/关闭思维链 | 需要深度推理时开启 |
| `/skip` | 跳过当前工具的权限询问 | 信任该工具后批量授权 |
| `/ta[ Tab ]` | 选择 Agent 类型 | 多步骤复杂任务 |
| `/todo` | 列出当前任务清单 | 追踪进度 |
| `/todos clear` | 清空任务清单 | 任务完成后 |
| `/whoami` | 查看当前账号信息 | 确认登录状态 |

### 多步骤指令示例

```
把 src/utils/ 目录下所有过时的日期格式化函数迁移到 date-fns，
更新所有调用处，运行测试确保没有回归，然后提交 commit。
```

一条指令，Claude Code 会自主：
1. Glob 搜索相关文件
2. 阅读现有代码理解逻辑
3. 引入 date-fns 并替换
4. 更新所有调用点
5. 运行测试
6. 生成 commit

### Skill 系统：把你的经验固化下来

Skill 是一份 Markdown 文档，告诉 Claude Code 在特定场景下该怎么工作。

```markdown
<!-- .claude/skills/code-review/SKILL.md -->
---
name: code-review
description: 对当前未提交的变更做代码审查
---

1. 运行 `git diff --cached` 查看暂存变更
2. 按文件分组检查：逻辑正确性、边界条件、性能隐患、命名规范
3. 对每个问题标注严重程度（critical/major/minor/suggestion）
4. 输出审查报告到 REVIEW.md，格式：每个问题一行，含文件路径和行号
```

使用：`/skill code-review`

### Loop 系统：让 AI 定时自动工作

```bash
# 每 5 分钟检查一次 CI 状态
/loop 检查 CI 状态，如果有失败的作业，读取日志并写一份 triage 报告

# 定时任务（周一到周五早上 9 点）
/loop --schedule "0 9 * * 1-5" 读取 open issues，按标签分组写入 TODO.md
```

### 与 MCP 集成

MCP（Model Context Protocol）让 Claude Code 能连接外部工具：

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_xxx" }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres"],
      "env": { "DATABASE_URL": "postgresql://..." }
    }
  }
}
```

集成后，Claude Code 可以直接查 GitHub issue、执行 SQL 查询、操作数据库。

---

## 二、Cursor：IDE 里的 AI 伙伴

Cursor 是基于 VS Code  fork 出来的 AI 原生编辑器，适合习惯图形界面的人。

### 核心功能

| 功能 | 说明 | 快捷键 |
|------|------|--------|
| **Tab 补全** | 上下文感知的代码补全，按 Tab 接受 | Tab |
| **Chat（Cmd+L）** | 对话式编码，支持多轮对话 | Cmd+L |
| **Composer（Cmd+I）** | 跨文件编辑，一次改多个文件 | Cmd+I |
| **Codebase 索引** | 自动索引整个项目，回答项目相关问题 | 自动 |
| **VS Code 兼容** | 所有 VS Code 插件和快捷键可用 | — |

### Composer vs Chat

```
Chat（Cmd+L）：
你问 → 它答 → 你在编辑器里手动应用建议
适合：提问、解释、讨论

Composer（Cmd+I）：
你描述目标 → 它直接改代码 → 你 review 并合并
适合：具体编码任务
```

### Cursor 的 Codebase 索引

Cursor 会自动把整个项目向量化并建立索引。你可以在 Chat 中直接问：

> "这个项目里处理支付的核心逻辑在哪里？"
> "帮我找到所有调用 createOrder 的地方"
> "这个项目的架构是什么样的？"

Cursor 会检索索引，给出精准的答案和文件路径。

### 模型选择

Cursor 支持多种模型：
- **Claude 系列**：Sonnet 4、Opus 4.8（推荐，质量最好）
- **GPT-4o**：通用能力强
- **Gemini 2.5 Pro**：1M 上下文，适合超长文件
- **本地模型（Ollama）**：隐私敏感场景


