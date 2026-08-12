# 个人展示网站

基于 **Astro** 的静态个人站，用于展示「项目经历」与「知识沉淀」，并内置基于本站笔记的 **AI 知识助手（RAG 问答）**。
技术方案、内容模型、部署步骤详见同目录 `PRD-个人展示网站.md`。

---

## 一、目录结构

```
个人网站/
├─ src/
│  ├─ components/        # 组件：Header / Footer / ThemeToggle / NoteCard
│  ├─ content/
│  │  ├─ config.ts      # 内容模型（notes 一个 collection 的字段定义/校验）
│  │  └─ notes/         # 知识沉淀 Markdown（每篇一个 .md）
│  ├─ layouts/          # 页面布局 BaseLayout
│  ├─ pages/            # 页面：index(首页，含 AI 对话框) / notes(文章列表+详情) / ask(AI 助手完整版)
│  ├─ env.d.ts
│  └─ styles/global.css # 全局样式（明暗主题 + 响应式）
├─ public/              # 静态资源 + notes-index.json（前端检索索引，构建时生成）
├─ scripts/             # generate-index.js：构建时把 notes 分块生成索引
├─ scf/                 # 腾讯云 SCF Web 函数（AI 后端：BM25 检索 + Agnes 流式生成）
├─ node_modules/        # 依赖（已随目录打包，无需联网重装）
├─ package.json / package-lock.json
├─ astro.config.mjs / tsconfig.json / .gitignore
├─ .env.example         # 环境变量模板（PUBLIC_ASK_API 等）
└─ PRD-个人展示网站.md  # 需求/技术方案存档
```

> 不进仓库的项（已在 `.gitignore`）：`.env`、`.astro/`、`dist/`、`node_modules/`、`pagefind/`、`.workbuddy/`（本地助手记忆/日志）。

---

## 二、环境要求

- **Node.js 18.17.1+**（推荐 20+ 或 22）。本目录已附带 `node_modules`，**本机直接运行即可，无需联网安装**。
- 若是**换到别的机器 / 删掉了 node_modules**，在该目录执行一次 `npm install` 即可（需联网）。

---

## 三、一键运行（本地预览）

在本目录打开终端，执行：

```bash
npm run dev
```

启动后访问 **http://localhost:4321/** 即可看到站点。
（Astro 默认端口 4321；如被占用，用 `npm run dev -- --port 4322` 换端口。）

> AI 对话框在本地需先把 `PUBLIC_ASK_API` 配成已部署的 SCF 函数 URL，否则前端会提示「尚未配置」；纯展示页面不受影响。

---

## 四、构建与部署

```bash
npm run build      # 1) generate-index.js 生成索引  2) astro build 输出 dist/  3) postbuild 跑 pagefind
npm run preview    # 本地预览构建后的产物
```

push 到 main 分支后，GitHub Actions 自动构建并部署到 **GitHub Pages**：
[https://fenghuajie1025.github.io](https://fenghuajie1025.github.io)

> 构建流程：`scripts/generate-index.js` 读取 `src/content/notes/*.md` → 分块生成 `public/notes-index.json`（前端用）与 `scf/notes-index.json`（打包进 SCF）；随后 `astro build`；最后 `pagefind` 生成站内全文搜索索引。

---

## 五、修改项目

所有内容都是 **Markdown 单一数据源**，改完即生效。每个 `.md` 文件分两部分：
- 顶部 `---` 之间的 **frontmatter**（字段/元数据，决定卡片怎么显示、怎么排序）
- 下方 **正文**（Markdown，详情页展示）

> 字段定义与校验在 `src/content/config.ts`，要加新字段按需在里面扩展即可。

### 5.1 知识沉淀 `src/content/notes/*.md`

**参数表：**

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `title` | 字符串 | ✅ | — | 文章标题 |
| `date` | 日期 | ✅ | — | 发布日期，格式 `YYYY-MM-DD`；列表页按 `date` 降序（新的在前） |
| `tags` | 字符串数组 | ❌ | `[]` | 标签，用于筛选/检索 |
| `summary` | 字符串 | ❌ | 无 | 摘要（列表卡片展示，不写则取正文开头） |
| `draft` | 布尔 | ❌ | `false` | 设为 `true` 则不发布（列表和首页都隐藏），用于存草稿 |

**示例：**
```markdown
---
title: 文章标题
tags: [AI, RAG]
date: 2026-07-20
summary: 一句话摘要（可选）
draft: false
---

正文……
```

### 5.2 通用规则
- `draft: true` 的内容在任何列表页和首页都不会出现，但文件保留在仓库里，方便日后改完再发布。
- 改完保存，dev 服务会热更新；构建时 `generate-index.js` 自动重新生成 AI 检索索引。
- 排序：按 `date` 降序排列。

---

## 六、AI 知识助手

内置基于本站笔记的 RAG 问答。两处入口：**首页 hero 下方的「AI 知识助手」对话框（紧凑版）** 与 **`/ask` 完整版**。

**链路：**
1. 构建时 `generate-index.js` 把 notes 按句分块生成索引。
2. 访客提问 → 前端 `POST` 到 SCF 函数 URL。
3. SCF 内做 BM25 检索召回相关片段，连同对话历史一起发给 **Agnes**（`apihub.agnes-ai.com`）流式生成带引用来源的中文回答。
4. SCF 以自定义 SSE 协议把回答流式回传前端，前端渲染 Markdown（标题/列表/表格/代码块等）。

**SCF 部署（腾讯云 Web 函数）：**
- 把 `scf/` 整目录上传为 Node 18+ **Web 函数**（监听 `0.0.0.0:9000`）。
- 「函数管理 → 函数 URL」开启公网访问 + 匿名，拿到 URL。
- 控制台「环境变量」配置（**密钥只放这里，绝不进前端/仓库**）：
  - `AGNES_API_KEY`（必填）
  - `AGNES_MODEL`（默认 `agnes-2.0-flash`）
  - `AGNES_BASE_URL`（默认 `https://apihub.agnes-ai.com/v1`）
  - 执行超时建议 **120s 以上**（否则长回答会被截断）。
- 把函数 URL 填进 `.env` 的 `PUBLIC_ASK_API`，再重新 `npm run build` 部署。

---

## 七、静态站部署到国内

GitHub Pages 是默认部署。若要放到国内（免备案子域或自有备案域名）：

1. 注册腾讯云账号，关联 Git 仓库（或本地用 CLI 推送本目录）。
2. 构建命令填 `npm run build`，输出目录填 `dist`。
3. 默认子域名（`*.tcloudbase.com`）**免 ICP 备案**即可访问；想用自己的域名再单独做备案 + DNS 解析。
4. AI 后端不受静态托管影响——始终走腾讯云 SCF（见第六节），密钥只在 SCF 控制台。

---

## 八、常见问题

- **端口被占用**：`npm run dev -- --port 4322`。
- **Node 版本过低**：升级到 18.17.1+（推荐 20+）。
- **换机器后跑不起来**：删除 `node_modules` 重新 `npm install`。
- **首页 / `/ask` 的 AI 对话提示「尚未配置」**：`.env` 里没填 `PUBLIC_ASK_API`，或 SCF 未部署。按第六节配好函数 URL 后重新构建。
- **AI 回答答到一半就断**：几乎都是 SCF 执行超时未调到 120s+ 或未「保存并部署」，去腾讯云控制台调整即可（详见方案文档）。

