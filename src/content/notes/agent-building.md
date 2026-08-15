---
title: "从零构建 Agent 系统：架构与模式"
tags: ["AI Agent", "Agent 架构", "ReAct", "任务分解", "多 Agent", "工具系统"]
date: 2026-08-15
summary: 不依赖 LangChain/LangGraph，从零实现 Agent 系统的工程实践。涵盖 ReAct 循环设计、工具系统抽象、任务分解与编排、记忆管理、错误处理等核心模块的具体实现方案和设计权衡。
draft: false
---

## 项目地址

https://github.com/FengHuaJie1025/FDE/tree/main/agent

## 设计原则

从零实现 Agent（不依赖 LangChain/LangGraph 等框架）的好处是深入理解底层原理，避免框架抽象带来的黑盒问题。

核心原则：

- **模块解耦**：LLM 调用、工具系统、Agent 循环、任务编排各自独立，可单独测试和替换
- **配置驱动**：所有可变参数集中在 config.yaml（提供商、模型、超参、工具配置）
- **统一抽象**：Agent 基类定义通用循环接口，ReAct 是其中一种实现，可替换为其他模式

典型目录结构：

```
src/
├── core/
│   ├── agent.py           Agent 基类（思考-行动-观察循环抽象）
│   ├── react_agent.py     ReAct Agent 实现
│   ├── orchestrator.py    多 Agent 编排器
│   └── memory.py          记忆管理（短期 + 长期）
├── tools/
│   ├── base.py            工具基类
│   └── builtin.py         内置工具集
├── planning/
│   ├── task.py            任务模型 + 依赖图
│   └── decomposer.py      任务分解器
└── llm/
    └── client.py          LLM 客户端适配
```

## Agent 基类与 ReAct 循环

### 核心循环抽象

```python
while current_step < max_steps:
    1. think()        → LLM 生成下一步
    2. parse_action() → 解析为行动指令
    3. act()          → 调用工具
    4. observe()      → 处理观察结果
    5. should_stop()  → 检查终止条件
```

关键参数：`max_steps` 防止无限循环（默认 15 步），`trajectory` 记录完整执行轨迹。

### ReAct 模式

ReAct（Reasoning + Acting）是最基础的 Agent 模式，核心是让 LLM 输出结构化的思考步骤：

```
Thought: 分析当前状态，决定下一步
Action: 工具名称
Action Input: {"参数名": "参数值"}

--- 收到 Observation 后 ---

Thought: 分析观察结果
Action: 下一个工具 / Final Answer
```

**为什么用文本格式而非 Function Calling？**

| 方式 | 优点 | 缺点 |
|------|------|------|
| 文本格式（ReAct） | 通用，任何模型都支持 | 需自行解析，可能格式错误 |
| Function Calling | 结构化，模型原生支持 | 仅部分模型支持，厂商绑定 |

从零实现的 Agent 通常选文本格式，因为它不依赖模型对 `tools` 参数的支持，可兼容 Ollama、千问等非 OpenAI 原生模型。生产环境建议两者都支持，根据提供商自动切换。

### 参数校验

在调用工具前应校验参数是否符合 JSON Schema：

```python
def validate_args(parameters: dict, args: dict) -> bool:
    """调用前校验参数。"""
    for name, schema in parameters.get("properties", {}).items():
        if name in schema.get("required", []):
            if name not in args:
                return False
        # 检查类型、枚举值等
    return True
```

这能有效防止 LLM 传了非法参数导致工具崩溃。

## 工具系统设计

### 工具接口

```python
class BaseTool:
    name: str          # 工具名称（Action 字段引用）
    description: str   # 工具描述（LLM 选择工具的依据）
    parameters: dict   # JSON Schema 参数声明

    def run(**kwargs) -> str:
        """执行工具，返回文本结果。"""
        pass
```

### 内置工具

| 工具 | 触发关键词 | 典型场景 |
|------|-----------|---------|
| calculator | 计算、数学、统计 | 数值计算、公式推导 |
| web_search | 搜索、查询、调研 | 实时信息获取、技术调研 |
| python_repl | 编程、代码、分析 | 数据处理、文件操作、自动化 |
| file_read | 读文件、查看 | 读取代码/文档/日志 |
| file_write | 写文件、保存 | 生成报告、保存结果 |
| finish | （隐式） | 终止循环，给出最终答案 |

### 工具调用的错误处理

工具调用可能失败，Agent 必须有容错能力：

```python
def act(self, action: str, action_input: dict) -> str:
    tool = self.tool_registry.get(action)
    if not tool:
        # 模型幻觉出未注册的工具
        return f"错误：未知工具「{action}」，可用工具：{self.tool_registry.list()}"

    if not validate_args(tool.parameters, action_input):
        return f"错误：参数校验失败，期望格式：{tool.parameters}"

    try:
        result = tool.run(**action_input)
        return str(result)
    except Exception as e:
        return f"工具执行出错：{type(e).__name__}: {e}"
```

关键设计：**工具出错不应让 Agent 崩溃，而是把错误信息作为 Observation 返回**，让 LLM 自己决定如何应对（换参数重试、换工具、或者直接告诉用户）。

## 任务分解与编排

当目标过于复杂时，单个 ReAct Agent 难以处理。需要先分解再执行。

### 任务模型

| 字段 | 类型 | 说明 |
|------|------|------|
| id | str | 唯一标识 |
| description | str | 任务描述 |
| dependencies | list[str] | 依赖的任务 ID |
| dep_type | hard / soft | 硬依赖（必须成功）或软依赖（可跳过） |
| tool_hints | list[str] | 可能需要的工具提示 |
| status | enum | pending / running / completed / failed / skipped |

### 任务分解

调用 LLM 分析复杂目标，输出 JSON 格式的子任务列表：

```python
def decompose(goal: str) -> list[Task]:
    prompt = f"""将以下目标分解为可独立执行的子任务：
目标：{goal}

要求：
1. 每个子任务应有清晰的描述
2. 子任务间如果有依赖关系，明确注明
3. 可能需要的工具可以提示
4. 输出 JSON 列表"""

    response = llm.get_json_response(prompt)
    return [Task(**item) for item in response]
```

分解后构建 TaskGraph（DAG），进行拓扑排序，检测循环依赖。

### 编排执行

```python
class Orchestrator:
    def run(self, tasks: list[Task]):
        graph = TaskGraph(tasks)

        while not graph.all_completed():
            # 取所有无依赖的待执行任务
            ready = graph.get_ready_tasks()

            # 并行执行无依赖任务
            with ThreadPoolExecutor() as pool:
                futures = [pool.submit(self.run_task, t) for t in ready]
                for future in as_completed(futures):
                    task = ready[futures.index(future)]
                    graph.mark_completed(task.id, future.result())
```

**并行执行无依赖任务**能显著提速。对于调研类任务，搜索和数据分析可以同时进行。

## 记忆管理

Agent 需要记忆来保持多步推理的一致性。

### 短期记忆

当前会话的所有消息和轨迹，用列表管理。关键问题是 **Context Window 溢出**：

```python
class ShortTermMemory:
    def __init__(self, max_tokens: int = 8000):
        self.messages = []
        self.max_tokens = max_tokens

    def add(self, message: dict):
        self.messages.append(message)
        self._prune()

    def _prune(self):
        """当上下文超限时，压缩历史。"""
        while self._estimate_tokens(self.messages) > self.max_tokens:
            # 策略：保留 system prompt + 最近 N 轮对话
            system = [m for m in self.messages if m["role"] == "system"]
            recent = [m for m in self.messages if m["role"] != "system"]
            # 移除最早的非系统消息
            if len(recent) > 2:
                recent.pop(0)
            self.messages = system + recent
```

更高级的压缩策略包括：
- **对话摘要**：将较旧的消息用 LLM 压缩为摘要
- **滑动窗口**：只保留最近 K 轮对话
- **Token 预算**：在请求前计算 token 数，超过则截断

### 长期记忆

跨会话的知识存储，用 JSON 文件持久化：

```python
class LongTermMemory:
    def __init__(self, persist_dir: str):
        self.persist_dir = persist_dir
        self.store = {}  # key: 知识点, value: 经验总结

    def save(self, key: str, value: str):
        self.store[key] = value
        self._persist()

    def search(self, query: str) -> list[str]:
        """可集成 Embedding 做语义检索（复用 RAG 系统的 embedding 模块）。"""
        return [v for k, v in self.store.items()
                if query in k or self._similar(query, k)]
```

长期记忆的进阶实现可复用 RAG 系统的 Embedding 模块，对记忆做向量化检索。

## 错误处理与鲁棒性

Agent 系统在实际运行中会遇到各种异常，需要分层处理：

### LLM 层错误

- **API 超时**：重试（指数退避），最多 3 次
- **JSON 解析失败**：要求 LLM 重新输出合法的 JSON
- **格式不符合预期**：重新提示并给出正例

### Agent 循环层错误

- **工具调用失败**：把错误信息作为 Observation，让 LLM 自行处理
- **无限循环**：`max_steps` 硬限制 + 检测重复模式（连续 N 步相同的 Thought/Action）
- **上下文溢出**：主动压缩历史或分段处理

### 编排层错误

- **子任务失败**：硬依赖失败 → 整体任务标记为失败；软依赖失败 → 跳过，记入日志
- **编排器崩溃**：记录已完成子任务的结果，支持断点续跑

## 几种 Agent 模式的对比与选择

| 模式 | 原理 | 适合场景 | 不适合场景 |
|------|------|---------|-----------|
| **ReAct** | 边想边做，每步决策 | 探索性任务、问题不明 | 步骤明确的大任务 |
| **Plan-and-Execute** | 先计划再逐项执行 | 步骤明确的复杂任务 | 需要中途调整的任务 |
| **Plan-and-Solve** | 计划 + 每步可修正 | 半结构化任务 | 快速问答 |
| **Function Calling** | 模型原生工具选择 | 工具调用密集型 | 仅支持部分模型 |
| **Multi-Agent** | 多角色分工协作 | 综合性大任务 | 简单任务（过度设计） |

选型建议：
- **简单问答** → 不需要 Agent，纯 LLM 即可
- **单步工具调用** → Function Calling 或简单 ReAct
- **多步调研** → ReAct 或 Plan-and-Solve
- **复杂项目** → 先 Plan 分解 → 再 Orchestrator 编排多 Agent 执行

## 扩展方向

1. **Streaming 输出**：Agent 思考过程实时流式输出到终端，提升用户体验
2. **工具权限控制**：为不同任务/用户配置不同的工具集合
3. **Human-in-the-loop**：关键步骤（如写文件、执行命令）请求人工确认
4. **Agent 间通信**：子 Agent 之间可以互相传递中间结果，而非仅通过编排器汇总
5. **自适应上下文管理**：根据当前 Token 消耗动态调整压缩策略