---
title: "Spring AI 框架入门与实践"
tags: ["Spring AI", "Java", "LLM", "RAG", "AI 框架"]
date: 2026-06-10
summary: Spring AI 是 Spring 生态的 AI 集成层，提供统一的 LLM 调用抽象、向量数据库集成、RAG 管线、Tool Calling 等能力。本文从架构设计到实战用法全面梳理。
draft: false
---

## 什么是 Spring AI

Spring AI 是 Spring 官方推出的 AI 应用开发框架，定位类似 Spring JDBC 对数据库的作用——为 LLM 调用提供统一抽象层，避免开发者直接对接各家厂商的 SDK。

核心设计目标：
- **可插拔 Provider 抽象**：一套 API 对接 OpenAI、Anthropic、通义千问、DeepSeek 等
- **Spring 原生**：利用 Spring Boot 的自动配置、AOP、事务等能力
- **企业级**：内置重试、熔断、观测（Micrometer）、缓存

## 核心模块

### ChatClient——统一的对话 API

```java
ChatClient chatClient = ChatClient.builder(chatModel).build();

String answer = chatClient.prompt()
    .system("你是一名资深 Java 工程师")
    .user("解释 Spring AI 的核心优势")
    .call()
    .content();
```

**流式调用：**
```java
Flux<String> stream = chatClient.prompt()
    .user("写一篇 500 字的 Spring AI 介绍")
    .stream()
    .content();
```

### ChatModel——底层抽象

Spring AI 抽象了 `ChatModel` 接口，各 Provider 实现：

| Provider | 实现类 | 模型示例 |
|----------|--------|---------|
| OpenAI | `OpenAiChatModel` | gpt-4o, gpt-4o-mini |
| Anthropic | `AnthropicChatModel` | claude-sonnet-4, claude-opus-4 |
| 通义千问 | `TongYiChatModel` | qwen-max, qwen-plus |
| Ollama | `OllamaChatModel` | llama3, qwen2 (本地) |
| DeepSeek | `DeepSeekChatModel` | deepseek-chat |

配置示例（application.yml）：

```yaml
spring:
  ai:
    openai:
      api-key: ${OPENAI_API_KEY}
      chat:
        model: gpt-4o
    tongyi:
      api-key: ${DASHSCOPE_API_KEY}
      chat:
        model: qwen-max
```

### EmbeddingModel——向量化抽象

```java
EmbeddingModel embeddingModel = new OpenAiEmbeddingModel(openAiApi);

List<Double> embedding = embeddingModel.embed("Spring AI 是什么？");
// 返回 1536 维向量
```

### VectorStore——向量数据库集成

```java
VectorStore vectorStore = new PgVectorStore(jdbcTemplate, vectorDimensions);

// 存储
List<Document> docs = List.of(new Document("Spring AI 是 Spring 生态的 AI 框架"));
vectorStore.add(docs);

// 检索
List<Document> results = vectorStore.similaritySearch(
    SearchRequest.query("AI 框架").withTopK(3)
);
```

支持的向量数据库：PgVector、Pinecone、Chroma、Milvus、Redis、Weaviate、Qdrant。

## RAG 管线

Spring AI 提供一站式 RAG 构建能力：

```java
@Bean
RetrievalAugmentationAdvisor ragAdvisor(
    VectorStore vectorStore,
    ChatClient.Builder chatBuilder) {

    return RetrievalAugmentationAdvisor.builder()
        .documentRetrieval(
            vectorStoreDocumentRetriever.builder()
                .vectorStore(vectorStore)
                .similarityThreshold(0.7)
                .topK(5)
                .build())
        .beforeAdvisor(
            questionContextAdvisor())   // 问题重写
        .afterAdvisor(
            citationAdvisor())          // 自动标注引用
        .build();
}
```

## Tool Calling（函数调用）

Spring AI 通过 `@Tool` 注解将 Spring Bean 暴露为 LLM 可调用的工具：

```java
@Component
public class OrderTools {

    @Tool("根据订单号查询订单状态")
    public String getOrderStatus(String orderId) {
        // 实际查询数据库
        return "订单 " + orderId + " 已发货，预计明天到达";
    }

    @Tool("取消指定订单（仅限待发货状态）")
    public String cancelOrder(String orderId) {
        // 执行取消逻辑
        return "订单 " + orderId + " 已取消成功";
    }
}
```

使用时只需将 Bean 注册到 ChatClient：

```java
String answer = chatClient.prompt()
    .user("查一下订单 ORD-2024-0001 的状态")
    .tools("orderTools")  // 自动发现 @Tool 方法
    .call()
    .content();
```

## 观测与监控

Spring AI 集成 Micrometer，开箱即用：

```yaml
management:
  endpoints.web.exposure.include: health,metrics,prometheus
```

自动暴露的指标：
- `ai.chat.model.requests` — 请求数
- `ai.chat.model.tokens` — Token 用量（分 input/output）
- `ai.chat.model.duration` — 响应延迟
- `ai.retry.attempts` — 重试次数

## 与 Spring 生态融合

这是 Spring AI 最大的差异化优势：

- **Spring Security**：用现有权限体系控制 AI 功能访问
- **Spring Cloud**：AI 服务注册发现、配置中心管理 Prompt 模板
- **Spring Batch**：批量数据预处理 + 批量 LLM 调用管线
- **Spring Modulith**：AI 功能作为独立模块管理

## 项目搭建（Maven）

```xml
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-openai-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
<dependency>
    <groupId>org.springframework.ai</groupId>
    <artifactId>spring-ai-pgvector-store-spring-boot-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

添加仓库（依赖在 Spring Milestones 仓库）：

```xml
<repositories>
    <repository>
        <id>spring-milestones</id>
        <url>https://repo.spring.io/milestone</url>
    </repository>
</repositories>
```

## 适用场景与局限

**适合**：
- 已有 Spring 技术栈的团队，集成成本最低
- 需要企业级可观测性、熔断、重试的应用
- 需要同时对接多家 LLM Provider 的场景

**局限**：
- 抽象层封装较厚，调试时需要理解多层调用链
- 新模型特性（如 Claude 的 extended thinking）支持有滞后
- 对非 Java 技术栈的团队无关

Spring AI 不追求最快跟进每个模型新特性，它的核心价值在于：**让 AI 集成像写 Spring 代码一样自然。**