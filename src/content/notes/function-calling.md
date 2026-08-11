---
title: "Function Calling：LLM 工具调用机制详解"
tags: ["Function Calling", "Tool Use", "LLM", "AI", "API"]
date: 2026-05-10
summary: Function Calling（工具调用）是 LLM 将自然语言意图转化为结构化 API 调用的核心能力。从基本原理到 Schema 设计，从多工具编排到实际模式，系统拆解这一关键机制。 
draft: false
---

## 什么是 Function Calling

Function Calling（函数调用，也称 Tool Use / Tool Calling）是指 LLM 在对话过程中，自主决定调用预定义的外部函数/工具的能力。

**核心流程：**

```
用户输入："帮我查一下北京的天气，然后添加到我的日历"
  │
  ▼
LLM 分析意图 → 确定需要两个工具：
  ├── get_weather(city="北京")
  └── add_calendar_event(title="天气信息", content="...")
  │
  ▼
平台层执行函数 → 返回结果
  │
  ▼
LLM 整合结果 → 组织自然语言回复
```

关键区别：**不是 LLM 在执行代码，而是 LLM 决定「应该调用什么函数、用什么参数」，由宿主环境执行并返回结果。** LLM 扮演的是「决策者」而非「执行者」。

## 工作原理

### 底层机制

```
User: "北京的天气怎么样？"
  │
  ▼
1. API 请求（messages + tools 定义）
  ┌─────────────────────────────────────────┐
  │ messages: [                             │
  │   {role:"user", content:"北京的天气怎么样？"} │
  │ ]                                       │
  │ tools: [                                │
  │   {                                     │
  │     type: "function",                   │
  │     function: {                         │
  │       name: "get_weather",              │
  │       description: "获取城市天气",       │
  │       parameters: {                     │
  │         type: "object",                 │
  │         properties: {                   │
  │           city: { type: "string" }      │
  │         },                              │
  │         required: ["city"]              │
  │       }                                 │
  │     }                                   │
  │   }                                     │
  │ ]                                       │
  └─────────────────────────────────────────┘
  │
  ▼
2. LLM 响应（非自然语言，而是工具调用指令）
  ┌─────────────────────────────────────────┐
  │ finish_reason: "tool_calls"             │
  │ tool_calls: [                           │
  │   {                                     │
  │     id: "call_abc123",                  │
  │     type: "function",                   │
  │     function: {                         │
  │       name: "get_weather",              │
  │       arguments: '{"city":"北京"}'      │
  │     }                                   │
  │   }                                     │
  │ ]                                       │
  └─────────────────────────────────────────┘
  │
  ▼
3. 宿主执行 get_weather("北京") → 返回结果
  │
  ▼
4. 第二次 API 请求（追加 tool 结果到 messages）
  ┌─────────────────────────────────────────┐
  │ messages: [之前的对话...,                │
  │   {role:"assistant", tool_calls:[...]}, │
  │   {role:"tool",                         │
  │    tool_call_id: "call_abc123",         │
  │    content: '{"温度":25,"天气":"晴"}'   │
  │   }                                     │
  │ ]                                       │
  └─────────────────────────────────────────┘
  │
  ▼
5. LLM 最终回复："北京今天天气晴朗，气温 25°C。"
```

### Token 层面的变化

Function Calling 的 token 消耗包含：

| 部分 | 说明 | 优化方向 |
|------|------|---------|
| **Tool 定义** | 每次请求都携带 tools 参数 | 精简 description，移除不必要参数 |
| **工具选择 token** | LLM 输出工具调用的 token | 尽量减少候选工具数量 |
| **参数生成 token** | LLM 生成的 JSON 参数 | 简化参数结构 |
| **结果注入** | tool 结果追加到 messages | 控制结果大小 |

## Tool Schema 设计

### 最佳实践

```json
{
  "type": "function",
  "function": {
    "name": "search_knowledge_base",
    "description": "搜索知识库获取相关信息。当用户询问技术问题、产品文档时使用。",
    "parameters": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "搜索关键词，应该提取用户问题中的核心概念，2-5 个词"
        },
        "category": {
          "type": "string",
          "enum": ["general", "api", "troubleshooting", "best_practice"],
          "description": "知识分类，默认 general"
        },
        "max_results": {
          "type": "integer",
          "description": "返回结果数量上限，默认 3，最多 10",
          "minimum": 1,
          "maximum": 10
        }
      },
      "required": ["query"]
    }
  }
}
```

### Schema 设计原则

1. **Description 就是 Prompt**

工具/参数的 description 是 LLM 决定「是否调用」和「填什么参数」的关键依据。

```json
// 不好的 description
"description": "搜索知识库"

// 好的 description
"description": "搜索知识库获取相关信息。当用户询问技术问题、产品文档时使用此工具。从用户问题中提取核心关键词作为 search_query。"
```

2. **用 Enum 约束参数**

```json
// 不好：自由输入
"priority": { "type": "string" }

// 好：枚举约束
"priority": {
  "type": "string",
  "enum": ["low", "medium", "high", "critical"],
  "description": "任务优先级"
}
```

3. **提供合理默认值**

```json
"max_results": {
  "type": "integer",
  "description": "返回数量（默认 5，最大 20）",
  "minimum": 1,
  "maximum": 20
}
```

## 多工具编排模式

### 模式 1：并行调用

LLM 可以在一次响应中发起多个独立工具调用（parallel tool calls）：

```
用户: "对比北京和上海今天的天气"

LLM 响应：
  ├── tool_call: get_weather(city="北京")
  └── tool_call: get_weather(city="上海")

两个调用互不依赖，可并行执行。
```

适用场景：多个独立数据查询、批处理操作。

### 模式 2：链式调用

一个工具的输出作为另一个工具的输入上下文：

```
用户: "在北京找一家评分 4.5 以上的川菜馆，帮我订明晚 7 点 2 位的桌"

Round 1:
  → search_restaurants(city="北京", cuisine="川菜", min_rating=4.5)
  ← 返回餐厅列表 [{id: "r123", name: "老四川", ...}]
  
Round 2:
  → book_table(restaurant_id="r123", time="2026-05-11 19:00", guests=2)
  ← 预订成功，订单号 BKN-789
```

链式调用需要多轮交互，LLM 在每轮决定下一步动作。

### 模式 3：条件路由

```python
# 根据意图路由到不同工具
INTENT_ROUTING = {
    "查询": search_database,
    "操作": execute_command,
    "分析": run_analysis,
    "闲聊": None,  # 直接用对话能力
}
```

### 模式 4：Agent 循环

```
LOOP:
  1. LLM 判断当前状态和下一步
  2. 如果有必要工具 → 调用工具 → 回到 1
  3. 如果任务完成 → 生成最终回复 → 退出
  4. 如果超过最大轮次 → 超时退出
```

这是 Agent 系统的基础模式。

## 错误处理

### 工具执行失败

```json
// 工具返回错误
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "{\"error\": \"API rate limit exceeded\", \"retry_after\": 60}"
}
```

LLM 会基于错误信息决定下一步：重试、换工具、还是告知用户。

### 常见错误处理策略

| 错误类型 | 处理方式 | Prompt 指导 |
|---------|---------|-------------|
| API 超时 | 重试 1-2 次 | "如果工具调用超时，重试最多 2 次" |
| 参数错误 | 调整参数重试 | "如果参数错误，尝试调整后重试" |
| 权限不足 | 告知用户无权限 | "如果返回 403，告知用户无访问权限" |
| 限流 | 等待后重试或降级 | "如果限流，等待 retry_after 秒后重试" |
| 工具不存在 | 尝试其他工具 | "如果工具不存在，尝试使用功能相近的其他工具" |

## 实战项目结构

```
src/
├── tools/
│   ├── __init__.py         # 工具注册
│   ├── weather.py          # 天气查询
│   ├── calendar.py         # 日历操作
│   ├── database.py         # 数据库查询
│   └── search.py           # 搜索工具
├── router/
│   ├── intent_classifier.py # 意图分类
│   └── tool_dispatcher.py   # 工具调度
├── handlers/
│   ├── tool_error.py        # 错误处理
│   └── tool_result.py       # 结果格式化
└── main.py                  # 主循环
```

## 总结

Function Calling 是 LLM 从「聊天机器」进化为「智能代理」的关键能力。理解它的核心在于：

1. **LLM 是决策者，不是执行者**——它决定调什么、用什么参数，不负责执行
2. **Tool Schema 就是 Prompt**——工具定义中的 description 直接决定 LLM 能否正确使用它
3. **编排决定能力边界**——并行/链式/条件路由/Agent 循环，不同模式适配不同复杂度
4. **错误处理是生产必备**——没有错误处理的生产级 Function Calling 等于没有