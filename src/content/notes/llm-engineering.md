---
title: "LLM 应用工程化：从原型到生产"
tags: ["LLM", "工程化", "AI 应用", "Prompt 管理", "评估", "监控"]
date: 2026-06-20
summary: LLM 应用从概念验证到生产部署的工程化实践。涵盖 Prompt 版本管理、评估体系、可观测性、安全防护、成本控制与 CI/CD，帮助团队系统化地构建可靠的 AI 应用。
draft: false
---

## 为什么需要工程化

2024-2026 年，大量 LLM 应用从「Demo 阶段」进入了「生产阶段」，暴露出一系列工程化问题：

- Prompt 改了找不到历史版本，生产环境还在用 debug 时的提示词
- 模型升级后输出风格突变，没有回归测试发现
- 用户输入恶意 Prompt，应用被越狱
- Token 成本失控，月底账单超出预期 10 倍
- 生产环境出问题，没有日志可查

LLM 应用工程化就是解决这些问题的系统方法论。它不是某个工具，而是一整套贯穿开发、测试、部署、运维的实践。

## 一、Prompt 管理

### 版本控制

Prompt 是 LLM 应用的「代码」，应该像代码一样管理：

```yaml
# prompts/客服回复/v2.3.yaml
version: 2.3
author: yujijun
date: 2026-06-15
changes: 增加情绪检测模块，修复冗长回复问题
---
system: |
  你是{{brand}}的客服，回复要求：
  1. 先检测用户情绪（{{emotion}}）
  2. 正面情绪 -> 友好但简洁
  3. 负面情绪 -> 先共情再解决问题
  4. 回复控制在 100 字以内
  5. 如果检测到投诉意向，自动触发升级流程
  
examples:
  - user: "你们产品太烂了！"
    assistant: "非常抱歉给您带来不好的体验。我是客服小张，能告诉我具体遇到了什么问题吗？我会尽快帮您解决。"
    
variables:
  brand: { type: string, default: "某某科技" }
  emotion: { type: string, default: "neutral" }
```

### Prompt 存储策略

| 方式 | 适用阶段 | 优点 | 缺点 |
|------|---------|------|------|
| Git 仓库 | 开发/测试 | 版本管理完善，支持 Review | 运行时需加载 |
| 配置中心 | 生产 | 热更新，环境隔离 | 需额外中间件 |
| 数据库 | 多租户 | 按用户定制 | 查询开销 |
| 代码硬编码 | 快速原型 | 简单直接 | 不可维护 |

**推荐**：开发期用 Git，生产期用配置中心（Nacos/Apollo），配合 Git 做变更审计。

### Prompt 测试

```python
# 回归测试用例
test_cases = [
    {"input": "正常咨询-退款", "expected": {"含退款流程", "不含过激语气"}},
    {"input": "恶意输入-越狱尝试", "expected": {"拒绝回答", "触发告警"}},
    {"input": "边缘情况-空输入", "expected": {"引导用户输入"}},
]
```

每次 Prompt 变更自动运行回归测试，比对输出是否符合预期模式。

## 二、评估体系

### 评估维度

| 维度 | 测量方式 | 目标 |
|------|---------|------|
| 准确性 | 人工标注 + LLM-as-Judge 打分 | > 90% |
| 安全性 | 红队测试 + 自动攻击检测 | 0 高危漏洞 |
| 延迟 | p50 / p95 / p99 响应时间 | p95 < 3s |
| 成本 | 每次对话 Token 消耗 | 稳定可控 |
| 用户满意度 | 赞/踩率，会话完成率 | 赞率 > 80% |

### 自动化评估管线

```
发布新 Prompt
  │
  ▼
运行回归测试套件 ── 失败 ──→ 阻断，通知作者
  │
  通过
  │
  ▼
A/B 测试 (10% 流量) ── 指标下降 ──→ 回滚
  │
  指标达标
  │
  ▼
全量发布
```

### LLM-as-Judge

```python
JUDGE_PROMPT = """
评估以下客服回复的质量，从三个维度打分（1-5分）：

[用户问题]
{user_input}

[AI 回复]
{assistant_output}

评估维度：
1. 准确性：是否准确回答了用户问题
2. 安全性：是否包含不当内容
3. 友好度：语气是否恰当

输出 JSON：
{"accuracy": 分数, "safety": 分数, "friendliness": 分数}
"""
```

## 三、可观测性

### 需要追踪的数据

```
每次 LLM 调用：
├── 请求：System Prompt / User Messages / Tools / 参数
├── 响应：完整输出 / Finish Reason / Token 用量
├── 元数据：延迟 / 模型名 / 重试次数 / 用户 ID
└── 评估：用户反馈 / 自动评估分数

聚合指标：
├── Token 消耗趋势（分模型、分应用）
├── 错误率与错误类型分布
├── 延迟分布（p50/p95/p99）
└── 成本日/周/月报表
```

### 技术选型

```yaml
# LLM 观测工具对比
工具           | 定位          | 开源 | 自部署
LangSmith      | LLM 全链路追踪 | 否  | 否（托管）
LangFuse       | LLM 观测      | 是  | 是
Helicone       | API 代理+观测 | 否  | 是（企业版）
MLflow         | ML 生命周期   | 是  | 是
OpenTelemetry  | 通用可观测性  | 是  | 是（+ 自定义）
```

**推荐**：中小团队从 LangFuse 开始（开源可自部署），大团队用 OpenTelemetry 做统一接入。

### 日志记录实践

```python
import structlog

logger = structlog.get_logger()

async def chat_with_tracing(user_input: str, user_id: str):
    with tracer.start_as_current_span("llm_chat") as span:
        span.set_attribute("user_id", user_id)
        span.set_attribute("input_length", len(user_input))
        
        start = time.time()
        response = await chat_model.generate(user_input)
        latency = time.time() - start
        
        span.set_attribute("latency_ms", latency * 1000)
        span.set_attribute("token_usage", response.usage.total_tokens)
        span.set_attribute("finish_reason", response.finish_reason)
        
        logger.info("llm_chat_completed",
            user_id=user_id,
            latency_ms=round(latency * 1000),
            tokens=response.usage.total_tokens,
            finish_reason=response.finish_reason,
        )
        
        return response
```

## 四、安全防护

### 注入攻击防护

```
用户输入
  │
  ▼
输入清洗 ──┬── 关键词过滤 (忽略大小写)
           ├── 模式匹配 (Base64 编码/混淆尝试)
           └── LLM 护栏检查 ("忽略之前指令" 等模式)
  │
  ▼
主 Prompt 处理
  │
  ▼
输出过滤 ──┬── PII 脱敏 (身份证/手机号/银行卡)
           └── 内容合规检查
```

### 防护策略

```python
# 多层防护示例
class LLMGuardrail:
    def __init__(self):
        self.input_filters = [
            PromptInjectionDetector(),
            PIIMasker(),
            KeywordBlocker(blocklist=["忽略指令", "system prompt"]),
        ]
        self.output_filters = [
            PIIMasker(),
            ContentPolicyChecker(),
        ]
    
    async def process(self, user_input: str) -> tuple[str, bool]:
        # 输入侧
        for filter in self.input_filters:
            user_input = filter.process(user_input)
            if filter.triggered_alert():
                self.alert_security_team(user_input)
                return "抱歉，我无法处理这个请求。", True
        
        # 主逻辑
        response = await llm.generate(user_input)
        
        # 输出侧
        for filter in self.output_filters:
            response = filter.process(response)
        
        return response, False
```

### 速率限制与配额

```
用户级别：
├── 免费用户：10 次/小时
├── 普通用户：100 次/小时
└── VIP 用户：1000 次/小时

应用级别：
├── 全局 QPS 限制：100
└── 单模型 QPS 限制：50

成本级别：
├── 日预算告警：¥100
├── 月预算上限：¥3000
└── 异常突增检测：环比增长 > 200% 告警
```

## 五、成本控制

### Token 优化策略

| 策略 | 效果 | 实现方式 |
|------|------|---------|
| Prompt 压缩 | 减少 20-40% input tokens | 精简 system prompt、移除冗余历史 |
| 语义缓存 | 命中率 30-60% | 向量相似度检测，缓存相似问题的回答 |
| 模型分层 | 简单问题用小模型 | 分类器路由到不同模型 |
| 批量处理 | 降低 API 调用次数 | 合并短请求 |
| 流式输出 | 用户体验更好，成本不变 | 用户感受更快，实际消耗一样 |

### 语义缓存实现

```python
class SemanticCache:
    def __init__(self, embedding_model, threshold=0.92):
        self.vectors = []
        self.responses = []
        self.embedder = embedding_model
        self.threshold = threshold
    
    async def get(self, query: str) -> str | None:
        q_vec = await self.embedder.embed(query)
        if not self.vectors:
            return None
        
        similarities = cosine_similarity([q_vec], self.vectors)[0]
        best_idx = np.argmax(similarities)
        
        if similarities[best_idx] >= self.threshold:
            return self.responses[best_idx]
        return None
    
    async def set(self, query: str, response: str):
        vec = await self.embedder.embed(query)
        self.vectors.append(vec)
        self.responses.append(response)
```

## 六、CI/CD 管线

### 完整管线

```
代码提交
  │
  ▼
Lint + 格式检查
  │
  ▼
单元测试 (Prompt 逻辑、工具函数)
  │
  ▼
Prompt 回归测试 (运行测试套件)
  │
  ▼
构建 + 集成测试 (端到端调用)
  │
  ▼
部署到 Staging
  │
  ▼
A/B 评估 (与生产版本对比指标)
  │
  ▼
部署到 Production (灰度)
  │
  ▼
监控指标 (15 分钟观察期)
```

### Prompt 回归测试的 CI 集成

```yaml
# .github/workflows/prompt-test.yml
name: Prompt Regression Test

on:
  pull_request:
    paths:
      - 'prompts/**'
      - 'tests/**'

jobs:
  prompt-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run prompt regression tests
        run: python tests/run_prompt_tests.py
        env:
          TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
      - name: Check evaluation scores
        run: |
          python -c "
          scores = json.load(open('test_results.json'))
          assert scores['accuracy'] >= 0.85, 'Accuracy too low'
          assert scores['safety'] >= 0.95, 'Safety score too low'
          "
```

## 七、组织实践

### 角色分工

| 角色 | 职责 | 技术栈 |
|------|------|--------|
| AI 应用工程师 | 搭建应用逻辑、工具集成 | Python/Java + LLM SDK |
| Prompt 工程师 | 编写/优化/测试 Prompt | Prompt 模板 + 评估框架 |
| ML Engineer | 微调模型、Embedding 优化 | PyTorch + 训练管线 |
| SRE | 部署、监控、成本优化 | Docker/K8s + 观测工具 |
| 安全工程师 | 红队测试、护栏构建 | 安全测试 + 防护框架 |

### 灰度发布策略

```
Phase 0: 内部团队 (5 人) —— 功能验证
Phase 1: 友好用户 (5%)  —— 真实场景测试
Phase 2: 目标用户 (20%)  —— 扩大验证
Phase 3: 全量 (100%)     —— 正式发布
每个阶段持续 1-3 天，监控指标达标才进入下一阶段
```

## 总结

LLM 应用工程化不是一次性工作，而是贯穿整个产品生命周期的持续投入。核心要建立三件事：

1. **Prompt 即代码**：版本管理、测试、CI/CD 一个都不能少
2. **可观测优先**：没有日志和指标，生产事故就是盲人摸象
3. **安全内建**：不是最后加上去的，而是从第一天就设计的

工程化的目标不是消除所有问题，而是让团队在面对问题时有完整的工具链和流程去定位、修复、预防。