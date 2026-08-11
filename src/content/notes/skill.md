---
title: "Skill：AI 编程中的技能系统"
tags: ["Skill", "AI 编程", "Claude Code", "自动化", "最佳实践"]
date: 2026-05-25
summary: Skill 是 Claude Code 等 AI 编程工具中的核心抽象——将可重复的交互流程封装为可复用的技能包。从 SKILL.md 格式到编写最佳实践，系统拆解 Skill 的设计哲学与实战。 
draft: false
---

## 什么是 Skill

Skill（技能）是 AI 编程工具（Claude Code 等）中的一种抽象机制。它的本质是：**把人类与 AI 之间的交互模式，封装成一份结构化文档，让 AI 可以在特定场景下自动按照这个模式工作。**

类比理解：
- 普通对话：每次你告诉 AI "用 xxx 方式做 yyy"
- Skill：你提前写好一份文档，告诉 AI "当遇到场景 A 时，按这个流程工作"

```
无 Skill：             有 Skill：
用户描述问题           用户描述问题
  │                      │
  ▼                      ▼
用户解释怎么做          AI 自动匹配 Skill
  │                      │
  ▼                      ▼
AI 按指令执行           AI 按 Skill 流程执行
  │                      │
  ▼                      ▼
用户检查结果            AI 输出结果
```

## Skill 的文件格式

Claude Code 的 Skill 本质上是一个 Markdown 文件，放在 `.claude/skills/<skill-name>/` 目录下。

基础结构：

```markdown
<!-- .claude/skills/ci-triage/SKILL.md -->

---
name: ci-triage
description: 读取 CI 失败和 open issues，写入待办清单。只读，不改代码。
---

1. 运行 `gh run list --status failure --limit 20` 读取日志
2. 交叉引用 `gh issue list --label bug`
3. 按根因分组失败，而非单个测试
4. 将发现追加到 TODO.md，最新在前
```

### 完整格式

```markdown
---
name: deploy-check        # 技能名，用于 `/skill deploy-check` 调用
description: 部署前检查清单，确保代码准备好上线
model: opus              # 可选：指定使用哪个模型
temperature: 0.2         # 可选：覆盖模型参数
---

## 步骤

1. **检查测试**：运行 `npm test`，确认全部通过
2. **检查构建**：运行 `npm run build`，确认无报错
3. **检查环境变量**：对比 `.env.production` 与 `.env.example`，确认无遗漏
4. **检查迁移**：如果有数据库迁移，确认向下兼容
5. **生成发布说明**：基于 `git log` 生成版本变更日志

## 输出要求

- 如果任何步骤失败，输出 ❌ + 失败原因，**不要继续后续步骤**
- 全部通过后，输出 ✅ + 简要报告

## 常见失败处理

- 测试失败：运行 `npm test -- --run` 获取完整错误信息
- 构建失败：检查 `dist/` 目录是否有残余文件
```

## Skill 的触发方式

### 1. 手动调用（/skill）

```bash
/skill ci-triage
```

### 2. 自动匹配（Triage Skills）

带有特定配置的 Skill 可以被自动触发：

```markdown
---
name: issue-triage
description: 当用户报告 bug 或问题时，自动按以下流程分析
trigger:                  # 触发条件
  pattern: "bug|问题|错误|失败|异常"
  scope: "issue_comment"  # 在 issue 评论中自动匹配
---
```

### 3. 作为其他 Skill 的子步骤

一个 Skill 可以在步骤中调用其他 Skill：

```markdown
## 步骤

1. 运行 `/skill ci-triage` 获取当前 CI 状态
2. 根据 triage 结果，执行修复
3. 运行 `/skill deploy-check` 验证修复
```

### 4. Loop 调度（/loop）

```bash
/loop 每天早上 9 点运行 ci-triage，输出到 TODO.md
--schedule "0 9 * * 1-5"
```

## Skill 的设计原则

### 1. 单一职责

一个 Skill 只做一件事，做好一件事。

```markdown
# 不好：一个大而全的 Skill
name: project-manager
# 包含部署、测试、代码审查、文档生成……

# 好：拆分成多个小 Skill
name: deploy-check
name: test-runner
name: code-review
name: doc-generator
```

### 2. 确定性优先

Skill 的步骤应该是可重复、可预期的。避免模糊描述：

```markdown
# 不好
name: debug-issue
描述：分析问题并修复

# 好
name: debug-issue
1. 运行测试，收集失败用例
2. 对每个失败用例，读取错误日志
3. 搜索相关源代码
4. 列出可能的根因（最多 3 个）
5. 对每个根因给出修复建议
```

### 3. 可验证的输出

每个 Skill 应该产生可检查的输出：

```markdown
## 输出

写入 `triage-report.md`，格式：
- 总览：通过数/失败数/跳过数
- 每个失败分组：
  - 根因描述
  - 关联测试用例
  - 相关代码文件（含行号）
  - 严重级别 (critical/major/minor)
```

### 4. 声明依赖和前提条件

```markdown
---
name: db-migrate-check
description: 检查数据库迁移是否安全
requires:                # 前置条件
  - command: "gh --version"
    message: "需要安装 GitHub CLI"
  - command: "node --version | cut -d. -f1 | xargs test 18 -le"
    message: "需要 Node.js 18+"
---

```

## Skill 的高级用法

### 多文件 Skill

Skill 可以包含多个文件，组织更复杂的逻辑：

```
.claude/skills/deploy/
├── SKILL.md          # 主入口
├── check.env.sh      # 环境检查脚本
└── templates/
    └── release-notes.md  # 生成发布说明的模板
```

### 带参数的 Skill

```markdown
---
name: run-tests
description: 运行指定模块的测试
parameters:
  - name: module
    type: string
    description: "测试模块名（如 api、ui、e2e）"
    required: true
  - name: coverage
    type: boolean
    description: "是否生成覆盖率报告"
    default: false
---

## 步骤

1. 运行 `npm test -- --module {{module}}`
2. 如果 {{coverage}}，运行 `npm run coverage`
3. 输出测试报告
```

使用时：

```bash
/skill run-tests module=api coverage=true
```

## Skill vs 其他抽象

| 概念 | 范围 | 是否持久化 | 触发方式 |
|------|------|-----------|---------|
| **Prompt** | 单次对话指令 | 否 | 每次手动输入 |
| **Skill** | 可复用流程文档 | 是（文件） | 手动/自动/定时 |
| **Loop** | 定时循环执行 | 是（配置） | 定时触发 |
| **Agent** | 独立运行的 AI 程序 | 是（配置） | 事件触发/持续运行 |
| **Workflow** | 多步骤编排 | 是（定义） | 手动/事件触发 |

## 实战：建立 Skill 库

### 推荐的 Skill 库结构

```
.claude/skills/
├── ci-triage/          # CI 失败分析
├── code-review/        # 代码审查规范
├── deploy-check/       # 部署前检查
├── doc-generator/      # 自动生成文档
├── db-migrate/         # 数据库迁移检查
├── api-test/           # API 测试
├── commit-message/     # 规范化提交信息
└── onboarding/         # 新项目上手引导
```

### 建立流程

1. **识别重复模式**：留意你一周内重复做了 3 次以上的操作
2. **先写后抽象**：第一次手动做，第二次写笔记备忘，第三次写成 Skill
3. **迭代改进**：每次使用后，检查是否遗漏步骤或可以优化
4. **分享和复用**：团队通用的 Skill 共享到项目仓库

## 总结

Skill 的核心价值不是"自动化"，而是**将经验文档化**。写好一个 Skill 相当于把你对这个领域的理解固化下来，让 AI（以及未来的你）可以重复使用这份经验。
