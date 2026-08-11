---
title: "MCP（Model Context Protocol）协议详解"
tags: ["MCP", "Model Context Protocol", "AI", "工具集成", "协议"]
date: 2026-05-20
summary: MCP 是 Anthropic 提出的开放协议，定义 AI 模型与外部工具/数据源的标准化交互方式。类似 USB-C 对设备的作用——让任何 AI 客户端都能无缝对接任何工具服务。
draft: false
---

##  MCP

MCP（Model Context Protocol）是 Anthropic 于 2024 年底提出的**开放协议**，全称 Model Context Protocol。它的目标是标准化 AI 模型与外部工具、数据源之间的通信方式。

类比理解：
- USB-C 让任何设备用同一接口充电和数据传输
- HTTP 让任何浏览器访问任何网站
- **MCP 让任何 AI 客户端连接任何工具服务**

在 MCP 之前，每个 AI 框架（LangChain、Semantic Kernel、Spring AI）都有自己的工具定义方式，工具无法跨框架复用。MCP 想要改变这一点。

## 架构设计

```
 ┌─────────────┐      MCP 协议      ┌──────────────┐
 │  AI 客户端   │ ◄──────────────► │  MCP 服务端   │
 │  (Host)      │                  │  (Server)     │
 │              │                  │              │
 │ Claude Code  │                  │  文件系统     │
 │ Cursor       │                  │  GitHub API   │
 │ VS Code AI   │                  │  数据库       │
 │ 自定义应用    │                  │  Slack        │
 └──────────────┘                  │  自定义工具    │
                                    └──────────────┘
```

### 核心概念

| 概念 | 说明 | 类比 |
|------|------|------|
| **Host** | AI 客户端，发起请求的一方 | 浏览器 |
| **Server** | 提供工具/资源/提示的服务端 | 网站服务器 |
| **Transport** | 通信传输层（stdio / HTTP SSE / Streamable HTTP） | HTTP 协议 |
| **Tool** | 可被 AI 调用的函数 | REST API 端点 |
| **Resource** | 可被 AI 读取的数据 | 文件/网页 |
| **Prompt** | 预定义的可复用提示模板 | API 模板 |
| **Capability** | 服务端声明支持哪些能力（tools/resources/prompts） | 能力清单 |

### 传输层

MCP 支持三种传输方式：

| 传输方式 | 适用场景 | 特点 |
|---------|---------|------|
| **stdio** | 本地 CLI 工具集成 | 通过 stdin/stdout 通信，子进程管理 |
| **HTTP SSE** | 远程服务端 | Server-Sent Events 推送，HTTP 请求响应 |
| **Streamable HTTP** | 双向流，新标准 | 客户端发起 POST，服务端流式返回 JSON |

## MCP 生命周期

### 连接建立

```
Client                                Server
  │                                      │
  ├── initialize (协议版本 + 能力声明) ──►│
  │◄── initialized (服务端能力+版本) ────┤
  │                                      │
  ├── tools/list ──────────────────────► │
  │◄── tools/list 结果 ─────────────────┤
  │                                      │
  ├── resources/list ──────────────────► │
  │◄── resources/list 结果 ─────────────┤
  │                                      │
  │        （开始正常通信）                │
  │                                      │
  ├── tools/call (tool_name, args) ────► │
  │◄── tools/call 结果 ─────────────────┤
  │                                      │
  ├── resources/read (uri) ────────────► │
  │◄── resources/read 结果 ─────────────┤
```

## 工具定义示例

### MCP 服务端（Python）

```python
# server.py
from mcp.server import Server
from mcp.types import Tool, TextContent

app = Server("my-tools")

@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="get_weather",
            description="获取指定城市的当前天气",
            inputSchema={
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名，如 北京、上海",
                    }
                },
                "required": ["city"],
            },
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "get_weather":
        city = arguments["city"]
        weather_data = await fetch_weather(city)
        return [TextContent(content=json.dumps(weather_data, ensure_ascii=False))]

if __name__ == "__main__":
    app.run(transport="stdio")
```

### MCP 客户端（Python）

```python
from mcp.client import ClientSession

async with ClientSession(transport="stdio") as session:
    # 初始化
    await session.initialize()
    
    # 获取工具列表
    tools = await session.list_tools()
    for tool in tools:
        print(f"Tool: {tool.name} - {tool.description}")
    
    # 调用工具
    result = await session.call_tool("get_weather", {"city": "北京"})
    print(result.content[0].content)
```

## 资源（Resources）

资源是 MCP 的重要概念——让 AI 读取服务端的数据：

```python
@app.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="docs://user-guide",
            name="用户手册",
            description="产品使用说明书",
            mimeType="text/markdown",
        )
    ]

@app.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "docs://user-guide":
        return open("docs/user-guide.md").read()
```

资源 URI 可以是任何自定义 scheme（`docs://`、`db://`、`file://`），服务端自行解析。

## MCP 在 Claude Code 中的应用

Claude Code 是 MCP 的典型 Host 实现。MCP 服务端通过 `~/.claude/settings.json` 配置：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/path/to/allowed"]
    },
    "github": {
      "command": "node",
      "args": ["path/to/github-mcp-server.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    },
    "database": {
      "command": "python",
      "args": ["mcp_db_server.py"],
      "env": {
        "DB_URL": "postgresql://..."
      }
    }
  }
}
```

配置后，Claude Code 自动发现这些工具，在合适时调用它们。

## Capabilities 协商

MCP 的 capability 系统允许服务端声明自己支持哪些功能：

```python
@app.get_capabilities()
def get_capabilities():
    return {
        "tools": {
            "listChanged": True,     # 支持工具列表变更通知
        },
        "resources": {
            "subscribe": True,       # 支持资源订阅
            "listChanged": True,     # 支持资源列表变更通知
        },
        "prompts": {
            "listChanged": False,    # 不支持提示列表变更
        },
        "logging": {},              # 支持日志
    }
```

客户端根据 capabilities 决定如何与服务端交互。这让老旧客户端兼容新服务端，反之亦然。

## 与直接 Tool Calling 的对比

| 维度 | 直接 Tool Calling | MCP |
|------|-----------------|-----|
| 集成方式 | 代码中硬编码 | 标准协议自动发现 |
| 跨框架复用 | 不可复用 | 任何 MCP Host 可用 |
| 运行时动态 | 需重启更新 | 可热插拔 |
| 工具市场 | 无 | 社区共享 MCP Server |
| 企业管控 | 需自建 | 统一管控和审计 |
| 复杂度 | 低 | 中（需 MCP 运行时） |

## 适用场景

**适合 MCP 的场景**：
- 需要接入多个工具服务（文件、数据库、API），不想每个都写胶水代码
- 工具需要跨多个 AI 客户端复用（Claude Code + Cursor + 自定义应用）
- 需要企业级工具管控（权限、审计、日志）
- 社区已有现成 MCP Server（GitHub、Slack、PostgreSQL、Sentry、Jira）

**不适合 MCP 的场景**：
- 只接入一个工具，且只需调用一次
- 工具对延迟极度敏感（MCP 有序列化开销）
- 运行环境无法启动子进程（如部分 Serverless 环境）

## 社区生态

截至 2026 年年中，MCP 生态已有：

- **官方 SDK**：Python、TypeScript、Java、Kotlin
- **社区 Server**：1000+ 个，覆盖 GitHub、Slack、Notion、Jira、PagerDuty、Sentry、PostgreSQL、Redis、Elasticsearch、Docker
- **主流 Host**：Claude Code、Cursor、VS Code AI（GitHub Copilot）、Continue、Sourcegraph Cody、Zed AI
- **企业集成**：支持 Okta 认证、审计日志、用量统计

MCP 正在成为 AI 工具集成的「HTTP 时刻」——一个开放的、标准化的协议层，让工具和服务可被发现、可组合、可复用。