---
title: 个人网站部署 GitHub Pages + 云函数对接 AI 助手
tags: ["网站部署", "GitHub Pages", "腾讯云 SCF", "云函数", "AI助手", "BM25"]
date: 2026-07-28
summary: 用 Astro 静态站 + GitHub Pages 托管前端、腾讯云 SCF 云函数承载 AI 后端（BM25 检索 + LLM 流式生成），前端跨域调用。零依赖实现与全流程避坑记录。
draft: false
---

## 给个人网站接一个"懂我笔记"的 AI 助手

我用 Astro 搭了个静态博客，笔记沉淀在 `src/content/notes/`。一直想加一个 AI 助手，能**基于站内笔记回答访客问题**（类似私有 RAG）。三个硬约束：

- **免费 / 低成本**，不想养一台常驻服务器；
- **国内能稳定访问**，别让访客卡在墙外；
- **不把模型 API Key 暴露在前端**，密钥只能待在服务端。

## 整体架构：静态站与 AI 后端分离

最终把"前端"和"AI 计算"拆开托管：

```text
浏览器
  │  (1) 加载静态站 + notes-index.json
  ▼
GitHub Pages  ── 全球 CDN，纯静态 HTML/JS/CSS
  │  (2) 跨域 POST /api/ask
  ▼
腾讯云 SCF Web 函数  ── BM25 检索 + 调 LLM 流式生成
  │
  ▼
LLM大模型
```

为什么要分开：

- **静态站放 GitHub Pages**：Astro 产出纯静态文件，全球 CDN 加速，推 `main` 即自动部署，免费。
- **AI 后端放腾讯云 SCF**：Web 函数有长期稳定的三级域名（免备案），函数 URL 公网可访问；密钥只在服务端环境变量，前端拿不到。
- **LLM大模型**：兼容 OpenAI Chat Completions 协议，响应快、适合问答。

方案对比：

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| EdgeOne Pages 边缘函数 | 前后端一体 | 默认域名 3 小时过期、无自定义域名（未备案） | 放弃 |
| Vercel / Cloudflare | 海外体验好 | 国内访问慢，破坏国内闭环 | 不选 |
| 静态站 GitHub Pages + AI 后端 SCF | 静态站全球 CDN；SCF 免备案长期稳定；密钥走环境变量 | 两个服务分开部署 | **采用** |

## 一、静态站部署到 GitHub Pages

### 1.1 构建链路

`npm run build` 实际跑了三步（见 `package.json` 的 `scripts`）：

1. `node scripts/generate-index.js` —— 扫描 `src/content/notes/*.md`，生成 `public/notes-index.json`（整篇 `entries` + 按句分块 `chunks`）。前端 AI 对话框加载它做检索展示；SCF 也用同一份 `chunks` 构建 BM25 索引。
2. `astro build` —— 产出 `dist/`。`PUBLIC_ASK_API`（SCF 函数地址）在此时由 `.env` 注入，内联进前端 JS。
3. `pagefind` —— 生成站内全文搜索索引（文章列表页的搜索）。

> ⚠️ 关键点：`PUBLIC_ASK_API` 以 `PUBLIC_` 前缀命名，是 Astro 的**公开环境变量**，会在构建时写死进前端 bundle。它只是函数 URL（非密钥），可以公开。

### 1.2 GitHub Actions 自动部署

仓库根 `.github/workflows/deploy-gh-pages.yml` 用官方 Astro 部署模板，注意 build step 多了 `env` 注入：

```yaml
name: 部署到 GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: 构建站点
        run: npm run build
        env:
          # 重要：CI 不会自动读取你的本地 .env，必须显式注入
          PUBLIC_ASK_API: ${{ secrets.PUBLIC_ASK_API }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### 1.3 第一个坑：CI 构建没有 API 地址

我在本地 `.env` 写了 `PUBLIC_ASK_API`，本地 `npm run build` 一切正常；但推到 GitHub 后线上 AI 助手一直提示"未配置函数地址"。

原因：GitHub Actions 的 `npm run build` 运行在干净环境，**不会读取你本地的 `.env`**。`PUBLIC_ASK_API` 缺失 → 前端 `import.meta.env.PUBLIC_ASK_API` 为 `undefined` → 调用发不出去。

修复：如上，在 workflow 的 build step 加 `env:` 注入；并在 GitHub 仓库 **Settings → Secrets and variables → Actions** 里新建 `PUBLIC_ASK_API`，值为你的 SCF 函数 URL。

> 若你的 workflow 里没有 `env:` 这一行，请补上。其他 CI（自托管、GitLab 等）同理，把同一变量透传进构建环境即可。

## 二、AI 后端：腾讯云 SCF 云函数

### 2.1 为什么是 SCF 而不是 EdgeOne / Vercel

我一开始想在 EdgeOne 边缘函数里做，但踩了两个钉子：

- EdgeOne Pages 默认只给预览地址，**3 小时过期**，没有自定义域名（未备案）；
- 腾讯云 **API 网关触发器已于 2024-07-01 停建、2025-06-30 下线**，SCF 现在只能用"函数 URL"。

于是改道：静态站用 GitHub Pages（海外 CDN 也挺快），AI 用 SCF 函数 URL（国内三级域名，长期稳定，免备案）。海外平台（Vercel / Cloudflare）虽然体验好，但国内访问不稳，反而破坏闭环。

### 2.2 零依赖实现（避开 Windows 上传陷阱）

SCF Web 函数运行时是 Node，但如果用 Express 这类依赖，**Windows 上传后 `npm install` 拉包可能失败**，导致函数启动崩溃、前端报 443 错误。

解决：**整个函数只用 Node 内置模块**（`http` / `fs` / `path`），不装任何 npm 包。上传即用的 zip 包极小、无安装步骤。

`scf/package.json`：

```json
{
  "name": "ask-scf",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "main": "index.js"
}
```

> `type: "commonjs"` 是因为根 `package.json` 是 ESM；SCF 函数用 CommonJS，需单独覆盖。

启动脚本 `scf/scf_bootstrap`（文件名固定，SCF 会执行它）：

```bash
#!/bin/bash
export PORT=9000
cd "$(dirname "$0")"
node index.js
```

### 2.3 核心：`index.js` 做了什么

流程：

1. 冷启动读 `scf/notes-index.json`，用 `search.js` 构建 BM25 索引（块级）；
2. 收到 `{ question, conversation }`，BM25 检索 top-6 块；
3. 拼系统提示 + 上下文，调 LLM（`stream: true`）；
4. 以**自定义 SSE 协议**流式回传。

监听 `0.0.0.0:9000`（SCF Web 函数约定端口）：

```js
const PORT = process.env.PORT || 9000
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ask] listening on 0.0.0.0:${PORT}`)
})
```

#### 自定义 SSE 协议

前端直接解析 OpenAI 的 SSE 比较绕，我改用更简单的自定义事件：每条消息是一个 `data: {json}\n\n`，用 `type` 字段区分阶段：

```js
function sendEvent(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`)
}
// 阶段：
// { type:'sources', references }  —— 先告诉前端用了哪些笔记
// { type:'delta', content }       —— 逐段增量文本
// { type:'done', references }     —— 结束
// { type:'error', message }       —— 出错
```

#### 调LLM并转发

 兼容 OpenAI 的 `/chat/completions`，直接 `fetch` 即可：

```js
const model = process.env.MODEL 
const baseUrl = (process.env.BASE_URL).replace(/\/$/, '')
const upstream = await fetch(`${baseUrl}/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.API_KEY}`,
  },
  body: JSON.stringify({ model, messages, stream: true, max_tokens: 2048, temperature: 0.7 }),
})
```

解析上游 SSE 时，用 `res.write` 逐段转发，并**处理背压**：如果写入缓冲满了（返回 `false`），就等 `'drain'` 再继续，避免内存暴涨：

```js
const writeDelta = async (content) => {
  const ok = res.write(`data: ${JSON.stringify({ type: 'delta', content })}\n\n`)
  if (!ok) await new Promise((r) => res.once('drain', r)) // 背压
  if (typeof res.flush === 'function') res.flush()
}
```

### 2.4 中文 BM25 检索

不依赖向量库，纯 BM25 关键词检索，足够覆盖"站内笔记问答"。难点是**中文分词**：

```js
function tokenize(text) {
  const tokens = []
  const lower = String(text).toLowerCase()
  for (let i = 0; i < lower.length; i++) {
    const ch = lower[i]
    if (/[一-鿿]/.test(ch)) {
      tokens.push(ch)                       // 单字 unigram
      if (i + 1 < lower.length && /[一-鿿]/.test(lower[i + 1]))
        tokens.push(ch + lower[i + 1])      // 相邻双字 bigram
    } else if (/[a-z0-9]/.test(ch)) {
      // 拉丁串（rag、mcp、embedding 等术语）整体作为一个 token
      let j = i, w = ''
      while (j < lower.length && /[a-z0-9]/.test(lower[j])) w += lower[j++]
      if (w) tokens.push(w)
      i = j - 1
    }
  }
  return tokens
}
```

打分用标准 BM25（k1=1.5, b=0.75），并对**标题/标签精确命中**额外加权（标题 ×1.4、标签 ×1.8），提升专有名词召回：

```js
const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5))
score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (dl / index.avgdl))))
// 标题/标签加权
if (q.some(t => tagsLower.includes(t))) score *= TAG_BOOST
else if (q.some(t => titleLower.includes(t))) score *= TITLE_BOOST
```

停用词表过滤"的了吗呢"等中文功能词，避免稀释打分。

### 2.5 部署到 SCF（关键配置）

1. 本地把 `scf/` 整个目录打包成 zip（含 `index.js` / `search.js` / `notes-index.json` / `scf_bootstrap` / `package.json`）；
2. 腾讯云控制台新建 **Web 函数**（Node 18+），上传 zip；
3. 函数配置里加环境变量：

   | 变量 | 说明 | 必填 |
   |---|---|---|
   | `API_KEY | API Key | 必填 |
   
4. **函数 URL**：创建并开启公网访问 + 匿名调用（NONE）；把得到的 URL（形如 `https://<sub>.ap-guangzhou.tencentscf.com`）填进本地 `.env` 的 `PUBLIC_ASK_API`；
5. **超时**：把"执行超时"调到 **120–300 秒**！默认只有 3 秒，长回答会被截断（见下文坑位）。

## 三、前端对接

### 3.1 跨域调用

前端从 `import.meta.env.PUBLIC_ASK_API` 取函数 URL，`POST /api/ask`，带上 `question`。SCF 已在响应头自带 CORS：

```js
res.setHeader('Access-Control-Allow-Origin', '*')
res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
```

> 坑：腾讯云控制台平台的"CORS 配置"里 `ExposeHeaders` **不能为空**，否则会报 `InvalidParameterValue.Cors (Invalid ExposeHeaders: )`。要么关掉平台 CORS（用代码自带头），要么填 `*`。

### 3.2 解析自定义 SSE

前端用 `fetch` + `ReadableStream` 逐行读取，按 `type` 渲染：

```js
const res = await fetch(API, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ question }),
})
const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
    if (!line.startsWith('data:')) continue
    const evt = JSON.parse(line.slice(5).trim())
    if (evt.type === 'sources') renderSources(evt.references)
    else if (evt.type === 'delta') appendMarkdown(evt.content) // 增量渲染
    else if (evt.type === 'done') finalize()
  }
}
```

### 3.3 Markdown 渲染

AI 返回的是 Markdown（`##`、表格、代码块、`**加粗**`）。前端做了个**轻量渲染器**：先 HTML 转义防注入，再只把识别出的 Markdown 语法替换成白名单标签，带 80ms 节流实时渲染。样式走 `.prose`（文章详情页同款）。

> 坑：Astro 的 `<style>` 是**作用域**的（编译后带 `data-astro-cid-*` 选择器）。JS 动态创建的聊天气泡没有这个属性，导致所有 scoped 样式失效（消息不靠右、表格无边框）。解决：给动态节点挂上页面的 `data-astro-cid-*` 属性，或把相关样式写成 `:global()`。

### 3.4 首页内嵌对话框

`/ask` 是完整版；首页 hero 区下方还嵌了一个紧凑版对话框（同一个 SCF 后端），让访客一进来就能问。

## 踩坑汇总

| 坑 | 现象 | 解决 |
|---|---|---|
| EdgeOne 默认域名 | 预览地址 3 小时过期 | 静态站转 GitHub Pages，AI 转 SCF |
| API 网关触发器停服 | `InvalidParameterValue` | 改用函数 URL |
| 平台 CORS ExposeHeaders 空 | 报 `Invalid ExposeHeaders: ` | 填 `*` 或关平台 CORS |
| Windows 上传后装包失败 | 函数 443 崩溃 | 零依赖 Node http，不装 npm 包 |
| 执行超时默认 3s | 回答被截断 | 控制台调到 120–300s 并保存部署 |
| 函数 URL 绑旧版本 | 改了不生效 | 确认绑定 `$LATEST` |
| 出站公网被关 | 函数访问 LLM 超时 | 保持"出站公网"默认开启 |
| 本地 .env 不进 CI | 线上"未配置 API" | workflow 注入 `PUBLIC_ASK_API` secret |
| Astro scoped CSS | 动态气泡样式失效 | 挂 `data-astro-cid` 或 `:global()` |

## 总结

静态站（GitHub Pages）+ AI 后端（腾讯云 SCF）+ LLM的组合，优势在于：

- **零服务器运维**，两边都按量 / 免费；
- **密钥只在服务端**，前端只持有公开的函数 URL；
- **国内闭环**，访问稳；
- 检索用轻量 BM25，够用且不烧钱。

整站代码见仓库 `scf/` 与 `src/pages/ask.astro`。有兴趣照着搭一套即可。
