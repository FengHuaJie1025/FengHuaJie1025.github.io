---
title: "LLM 对话机器人架构设计"
tags: ["LLM", "架构", "对话系统", "OpenAI SDK", "设计模式"]
date: 2026-08-08
summary: 基于 OpenAI SDK 构建通用 LLM 对话机器人的架构设计。通过配置驱动和工厂模式，用一套代码兼容 Chat Completions 和 Responses API 两种模式，支持多个厂商的后端切换。
draft: false
---

## 整体架构

```
config.yaml          ← 配置中心（提供商、模式、超参）
        │
        ▼
llm_client.py        ← 核心层（客户端工厂 + 双模式实现）
        │
        ▼
chatbot.py           ← 表现层（CLI 交互 + 对话管理）
```

三层各司其职、互不耦合：

- **配置层**：所有可变参数集中在 YAML 文件，修改配置即可切换后端，无需改代码
- **核心层**：封装两种 API 模式，对外暴露统一 `stream()` 接口
- **表现层**：处理用户输入输出，不关心底层是 Chat 还是 Responses

## 两种 API 模式

OpenAI 目前并行维护两套接口规范：

| 维度 | Chat Completions | Responses API |
|------|-----------------|---------------|
| 接口路径 | `POST /v1/chat/completions` | `POST /v1/responses` |
| 消息格式 | `messages: [{role, content}]` | `input: str \| list[dict]` |
| 上下文传递 | 手动拼接历史消息 | `previous_response_id` 自动关联 |
| 流式事件 | `chat.completion.chunk` | `response.output_text.delta` 等类型化事件 |
| 厂商支持 | 几乎所有（Claude、千问、Ollama 等） | 目前仅 OpenAI |
| 定位 | 稳定成熟的传统接口 | 新一代接口，原生支持 tools/函数调用 |

设计目标：**让调用方不关心底层模式，通过配置自动路由**。

## 工厂模式

```python
def build_client() -> "LLMClient":
    mode = get_mode()
    if mode == "responses":
        return ResponsesClient()
    return ChatClient()
```

这是典型的**依赖倒置**：表现层只依赖抽象接口 `stream()`，不依赖具体实现。

## OpenAI SDK 的统一兼容层

这个项目只依赖 `openai` SDK，不引入各厂商的原生 SDK（如 `anthropic`）。原理是 OpenAI SDK 的 `base_url` 参数可以重定向到任何兼容 OpenAI 接口格式的服务端：

```python
def _make_openai_client(self) -> openai.OpenAI:
    api_key = self.provider_cfg.get("api_key", os.environ.get("OPENAI_API_KEY", ""))
    base_url = self.provider_cfg.get("base_url")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return openai.OpenAI(**kwargs)
```

### 各厂商接入方式

| 提供商 | 模式 | 关键配置 | 注意事项 |
|--------|------|---------|---------|
| OpenAI | chat / responses | 填 API Key | 完全兼容 |
| Azure OpenAI | chat | `base_url` + `api_version` | 模型名用部署名 |
| 通义千问 | chat | `base_url` 指向兼容端点 | 模型名 `qwen-xxx` |
| Ollama | chat | `base_url` 指向 `/v1` | API Key 填 dummy |
| Anthropic | chat | 需 `litellm` 中转 | 原生 SDK 不兼容此方案 |
| Agnes | chat | `base_url` 指向 `apihub.agnes-ai.com` | 国内大模型 |

**优点**：只维护一个 SDK 版本，降低依赖复杂度，切换厂商只需改配置。
**缺点**：Anthropic 等不兼容 OpenAI 格式的厂商需要额外中转层；无法使用厂商独有的高级特性。

## 流式响应的统一封装

### Chat 模式

```python
def _stream_chat(self, kwargs) -> Iterator[dict]:
    stream = self.client.chat.completions.create(**kwargs)
    for chunk in stream:
        delta = chunk.choices[0].delta
        yield {"delta": delta.content or "", "finish_reason": chunk.choices[0].finish_reason}
```

### Responses 模式

```python
def _stream_responses(self, kwargs) -> Iterator[dict]:
    with self.client.responses.stream(**kwargs) as stream:
        for event in stream:
            if event.type == "response.output_text.delta":
                yield {"delta": event.delta, "finish_reason": None}
            elif event.type == "response.completed":
                yield {"delta": "", "finish_reason": "stop"}
```

两种模式的流式输出统一成相同的 `{"delta", "finish_reason"}` 格式，上层无需关心底层事件结构。

### 流式 vs 非流式的设计选择

**同步请求**适合需要完整结果后再做后续处理的场景（如 LLM-as-Judge、批量评估）。
**流式请求**适合面向用户的对话场景，可以边生成边展示，提升交互体验。

项目中两种都支持，通过 `stream=True/False` 参数切换。

## 对话历史管理

```python
messages: list[dict] = []

# 系统提示置首位
if system_prompt:
    messages.append({"role": "system", "content": system_prompt})

# 每轮追加
messages.append({"role": "user", "content": user_input})
# ...模型回复...
messages.append({"role": "assistant", "content": assistant_reply})
```

设计要点：
- 系统提示放在历史列表首位，不会被对话冲掉
- 每轮追加 user 和 assistant 两条消息，保持对话上下文
- `clear` 命令清空历史但保留 system prompt
- 出错时 `messages.pop()` 回滚最后一条用户消息，避免污染历史

### 一、Function Calling

Chat 模式原生支持 `tools` 参数，可在 `kwargs` 中透传。但真正要做得好，需要一套完整的工具定义、调用派发和结果回注机制。

#### 工具定义（配置层）

```yaml
# config.yaml
tools:
  - type: function
    function:
      name: get_weather
      description: 查询指定城市的当前天气
      parameters:
        type: object
        properties:
          city: { type: string, description: "城市名，如 北京、上海" }
        required: [city]
  - type: function
    function:
      name: search_docs
      description: 搜索内部知识库
      parameters:
        type: object
        properties:
          query: { type: string }
          limit: { type: integer, default: 3 }
        required: [query]
```

#### 工具注册与派发（核心层）

```python
# llm_client.py
import json

class ToolRegistry:
    """统一管理工具定义和执行。"""
    def __init__(self):
        self._tools: list[dict] = []
        self._handlers: dict[str, callable] = {}

    def load_from_config(self, config_tools: list[dict]):
        self._tools = config_tools

    def register(self, name: str, handler: callable):
        """注册工具的执行函数。"""
        self._handlers[name] = handler

    def get_tools_spec(self) -> list[dict]:
        return self._tools

    def dispatch(self, tool_calls: list[dict]) -> list[dict]:
        """执行工具调用，返回结果列表。"""
        results = []
        for tc in tool_calls:
            name = tc["function"]["name"]
            args = json.loads(tc["function"]["arguments"])
            handler = self._handlers.get(name)
            if not handler:
                results.append({
                    "tool_call_id": tc["id"],
                    "output": json.dumps({"error": f"未知工具: {name}"}),
                })
                continue
            try:
                output = handler(**args)
                results.append({
                    "tool_call_id": tc["id"],
                    "output": json.dumps(output, ensure_ascii=False),
                })
            except Exception as e:
                results.append({
                    "tool_call_id": tc["id"],
                    "output": json.dumps({"error": str(e)}),
                })
        return results
```

#### 多轮工具调用循环

模型可能在一次响应中同时调用多个工具（并行调用），也可能根据工具结果继续调用下一轮工具。客户端需要处理这种循环：

```python
def chat_with_tools(user_input: str, registry: ToolRegistry) -> str:
    messages = [{"role": "user", "content": user_input}]

    while True:
        resp = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=registry.get_tools_spec(),
        )
        choice = resp.choices[0]
        msg = choice.message

        if not msg.tool_calls:
            # 模型直接回复文本，结束循环
            return msg.content or ""

        # 追加 assistant 消息（含 tool_calls）
        messages.append({"role": "assistant", "content": msg.content, "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})

        # 执行工具并追加结果
        tool_results = registry.dispatch([tc.model_dump() for tc in msg.tool_calls])
        for tr in tool_results:
            messages.append({"role": "tool", "tool_call_id": tr["tool_call_id"], "content": tr["output"]})

        # 进入下一轮循环，模型根据工具结果继续推理
```

**关键设计点：**

- `while True` 循环处理多轮工具调用，直到模型直接回复文本
- 每条 tool call 的 `id` 必须与 tool result 的 `tool_call_id` 精确对应
- 工具结果以 JSON 字符串返回，因为 API 的 `content` 字段要求字符串
- 需要设最大轮次上限（如 10 轮），防止模型陷入死循环

#### 异常情况处理

```python
MAX_TOOL_ROUNDS = 10

for round in range(MAX_TOOL_ROUNDS):
    # ... 上述逻辑 ...
else:
    return "模型在工具调用中超过了最大轮次，请简化问题后重试。"
```

常见的异常情况：

- **工具不存在**：模型可能幻觉出未注册的工具名，返回错误信息让模型自行纠正
- **参数格式错误**：模型输出的 JSON 可能不合法，捕获异常后通知模型重新格式化
- **工具执行超时**：对每个工具调用设置超时（如 10s），超时返回错误
- **循环死锁**：模型反复调用同一个工具而不推进对话，需轮次上限兜底

---

### 二、可观测性

对话机器人生产运行需要追踪的数据：

```
每次 LLM 调用：
├── 请求：完整 messages / tools / model / 参数 (temperature 等)
├── 响应：完整输出 / finish_reason / token 用量
├── 元数据：延迟 / 模型名 / 提供商 / 重试次数 / 用户 ID / 会话 ID
└── 评估：用户反馈（赞/踩） / 自动质量评分

聚合指标：
├── Token 消耗趋势（按模型、按用户）
├── 错误率与类型分布（超时 / 限流 / 无效请求）
├── 延迟分布（p50 / p95 / p99）
└── 成本报表（日 / 周 / 月）
```

#### 日志注入（核心层）

```python
# llm_client.py
import logging
import time
import uuid

logger = logging.getLogger("llm_client")

class LoggedClient:
    """装饰器模式：在原始客户端外套一层日志。"""

    def __init__(self, inner: "LLMClient"):
        self._inner = inner
        self._session_id = uuid.uuid4().hex[:8]

    def stream_text(self, **kwargs) -> Iterator[dict]:
        call_id = uuid.uuid4().hex[:12]
        start = time.monotonic()

        # 记录请求（注意脱敏）
        safe_kwargs = {k: v for k, v in kwargs.items() if k != "api_key"}
        logger.info("llm_request",
            call_id=call_id,
            session=self._session_id,
            model=safe_kwargs.get("model"),
            messages_count=len(safe_kwargs.get("messages", [])),
            provider=self._inner.provider_name,
        )

        total_tokens = 0
        try:
            for chunk in self._inner.stream_text(**kwargs):
                total_tokens += 1
                yield chunk

            elapsed = time.monotonic() - start
            logger.info("llm_response",
                call_id=call_id,
                elapsed_ms=round(elapsed * 1000),
                chunks=total_tokens,
                finish_reason=chunk.get("finish_reason"),
            )
        except Exception as e:
            elapsed = time.monotonic() - start
            logger.error("llm_error",
                call_id=call_id,
                elapsed_ms=round(elapsed * 1000),
                error_type=type(e).__name__,
                error=str(e),
            )
            raise
```

**设计要点：**

- 使用**装饰器模式**包装原始客户端，不侵入核心逻辑
- 每次调用生成唯一 `call_id`，方便在日志系统中关联请求和响应
- `session_id` 标识一次完整对话，用于聚合多轮指标
- 记录请求日志时对敏感字段（api_key）做脱敏
- 异常捕获后记录错误详情再重新抛出，不影响上游错误处理

#### Token 用量追踪

Chat Completions 的响应中自带 `usage` 字段：

```python
response = self.client.chat.completions.create(**kwargs)
usage = {
    "prompt_tokens": response.usage.prompt_tokens,
    "completion_tokens": response.usage.completion_tokens,
    "total_tokens": response.usage.total_tokens,
}
```

但流式模式下，token 用量信息通常在**最后一个 chunk** 的 `usage` 字段中返回（部分厂商在最后一个 chunk 的 `choices[0].finish_reason` 之后附带 `usage`）。需要在迭代器中暂存：

```python
def _stream_chat(self, kwargs) -> Iterator[dict]:
    stream = self.client.chat.completions.create(**kwargs)
    usage_info = {}
    for chunk in stream:
        if hasattr(chunk, "usage") and chunk.usage:
            usage_info = {
                "prompt_tokens": chunk.usage.prompt_tokens,
                "completion_tokens": chunk.usage.completion_tokens,
                "total_tokens": chunk.usage.total_tokens,
            }
        delta = chunk.choices[0].delta
        yield {"delta": delta.content or "", "finish_reason": chunk.choices[0].finish_reason}
    # 流结束后 yield 用量信息
    if usage_info:
        yield {"type": "usage", **usage_info}
```

#### 用户反馈收集

```python
# chatbot.py
def record_feedback(session_id: str, message_id: str, rating: int, comment: str = ""):
    """记录用户反馈，用于后续评估和改进。"""
    logger.info("user_feedback",
        session_id=session_id,
        message_id=message_id,
        rating=rating,  # 1=踩, 2=一般, 3=赞
        comment=comment,
    )
    # 同时写入持久化存储，用于离线分析
    feedback_store.append({
        "session_id": session_id,
        "message_id": message_id,
        "rating": rating,
        "comment": comment,
        "timestamp": time.time(),
    })
```

---

### 三、重试与退避

生产环境中 API 调用不可避免会遇到限流（429）、服务端错误（500）和网络超时，需要一套稳健的重试机制。

#### 指数退避实现

```python
import time
import random

def retry_with_backoff(func, max_retries=3, base_delay=1.0, max_delay=60.0):
    """通用重试装饰器，指数退避 + 随机抖动。"""
    for attempt in range(max_retries + 1):
        try:
            return func()
        except (openai.RateLimitError, openai.APITimeoutError,
                openai.InternalServerError, openai.APIConnectionError) as e:
            if attempt == max_retries:
                raise  # 最后一次失败不重试

            delay = min(base_delay * (2 ** attempt), max_delay)
            jitter = random.uniform(0, delay * 0.1)  # 10% 随机抖动
            actual_delay = delay + jitter

            logger.warning("llm_retry",
                attempt=attempt + 1,
                max_retries=max_retries,
                delay_ms=round(actual_delay * 1000),
                error_type=type(e).__name__,
            )
            time.sleep(actual_delay)
```

**不用重试的错误**（应快速失败）：

- `openai.BadRequestError`（400）：请求参数错误，重试没用
- `openai.AuthenticationError`（401）：API Key 无效
- `openai.PermissionDeniedError`（403）：无权访问该模型
- `openai.NotFoundError`（404）：端点不存在

#### 重试集成到客户端

```python
class ChatClient:
    def _stream_chat(self, kwargs: dict) -> Iterator[dict]:
        response = retry_with_backoff(
            lambda: self.client.chat.completions.create(**kwargs)
        )
        for chunk in response:
            yield self._normalize_chunk(chunk)
```

---

### 四、超时与取消机制

流式请求可能因为网络、模型推理阻塞等原因卡住。客户端需要能主动取消。

#### 带超时的流式读取

```python
import signal

class TimeoutIterator:
    """为迭代器添加超时保护。"""
    def __init__(self, iterator, timeout=30.0):
        self._iterator = iterator
        self._timeout = timeout

    def __iter__(self):
        return self

    def __next__(self):
        # 对每次迭代设置超时
        # 实际项目可用 asyncio.wait_for 替代（异步场景）
        return next(self._iterator)  # 生产环境替换为超时实现

# 在 chatbot.py 中
def stream_with_timeout(bubble, iterator, timeout=30.0):
    start = time.time()
    for chunk in iterator:
        if time.time() - start > timeout:
            raise TimeoutError("响应超时")
        yield chunk
```

#### 用户取消

CLI 场景下，用户可以随时按 Ctrl+C 取消当前正在生成的回复：

```python
# chatbot.py
try:
    for chunk in client.stream_text(**kwargs):
        print(chunk["delta"], end="", flush=True)
        response_text += chunk["delta"]
except KeyboardInterrupt:
    print("\n[已取消]")
    # 回滚历史，不保留不完整的回复
    messages.pop()  # 移除 assistant 占位
    history.rollback()
```

**注意**：取消后必须回滚消息历史，否则下次对话会带上不完整的 assistant 消息，影响模型行为。

---

### 五、语义缓存

对于高频相似问题，可以用语义缓存避免重复调用 LLM，降低成本、降低延迟。

#### 实现方案

```python
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

class SemanticCache:
    def __init__(self, embedder, threshold=0.92, max_size=1000):
        self.embedder = embedder        # 嵌入模型（如 text-embedding-3-small）
        self.threshold = threshold      # 相似度阈值
        self.max_size = max_size
        self._vectors: list[list[float]] = []
        self._responses: list[str] = []
        self._queries: list[str] = []

    def get(self, query: str) -> str | None:
        if not self._vectors:
            return None
        q_vec = self.embedder.embed(query)
        sims = cosine_similarity([q_vec], self._vectors)[0]
        best_idx = int(np.argmax(sims))
        if sims[best_idx] >= self.threshold:
            return self._responses[best_idx]
        return None

    def set(self, query: str, response: str):
        vec = self.embedder.embed(query)
        self._vectors.append(vec)
        self._responses.append(response)
        self._queries.append(query)
        # 超出上限时淘汰最早的
        if len(self._vectors) > self.max_size:
            self._vectors.pop(0)
            self._responses.pop(0)
            self._queries.pop(0)
```

**缓存策略选择：**

| 维度 | 写穿透（Write-Through） | 惰性写入（Lazy Write） |
|------|------------------------|----------------------|
| 写入时机 | 每次 LLM 回复后立即缓存 | 仅当缓存未命中且 LLM 回复后才写入 |
| 优点 | 下次命中率高 | 避免缓存无效的回复（如错误消息） |
| 缺点 | 可能缓存错误回复 | 首次未命中写入有延迟 |

**推荐**：惰性写入 + 在写入前做简单的质量校验（如检查 finish_reason 是否为 "stop"、回复长度是否合理）。

---

### 六、多模态扩展

随着多模态模型普及，对话机器人需要能处理图片、音频、文件等输入。

#### 支持图片输入

```python
def build_messages_with_images(text: str, image_urls: list[str]) -> list[dict]:
    """构建含图片的多模态消息。"""
    content = [{"type": "text", "text": text}]
    for url in image_urls:
        # 支持 URL 和 Base64 两种形式
        if url.startswith("data:"):
            content.append({"type": "image_url", "image_url": {"url": url}})
        else:
            content.append({"type": "image_url", "image_url": {"url": url}})
    return [{"role": "user", "content": content}]
```

**集成方式：**

- Chat 模式原生支持 `content` 字段为数组，可以直接透传
- Responses 模式支持 `input` 中包含 `type: "image"` 的 item
- 关键在于核心层的 `stream_text()` 接口**不限制 messages 格式**，只是透传到 provider，所以多模态天然支持

```python
# 使用者只需传入符合 OpenAI 格式的消息，客户端层无需任何改动
messages = build_messages_with_images("这张图里有什么？", ["https://example.com/photo.jpg"])
for chunk in client.stream_text(messages=messages, model="gpt-4o"):
    print(chunk["delta"], end="")
```

---

### 七、Provider 负载均衡与健康检查

当有多个同类型 Provider 时（如多个 OpenAI 账号），可以实现负载均衡：

```python
class LoadBalancedClient(LLMClient):
    def __init__(self, providers: list[dict]):
        self._providers = providers
        self._current = 0

    def _get_next_client(self) -> openai.OpenAI:
        provider = self._providers[self._current]
        self._current = (self._current + 1) % len(self._providers)
        return openai.OpenAI(
            api_key=provider["api_key"],
            base_url=provider.get("base_url"),
        )

    def stream_text(self, **kwargs) -> Iterator[dict]:
        client = self._get_next_client()

        # 健康检查：用简单请求探测可用性
        try:
            return self._stream_with_client(client, **kwargs)
        except (openai.APIConnectionError, openai.RateLimitError) as e:
            logger.warning("provider_unhealthy", provider=client.base_url)
            # 切换下一个 provider 重试
            client = self._get_next_client()
            return self._stream_with_client(client, **kwargs)
```