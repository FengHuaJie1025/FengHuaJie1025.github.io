# 个人展示网站

基于 **Astro** 的静态个人站，用于展示「项目经历」与「知识沉淀」。
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
│  ├─ pages/            # 页面：首页 / notes / search / ask(二期占位)
│  ├─ env.d.ts
│  └─ styles/global.css # 全局样式（明暗主题 + 响应式）
├─ public/              # 静态资源（favicon 等）
├─ node_modules/        # 依赖（已随本目录打包，无需联网重装）
├─ package.json
├─ package-lock.json
├─ astro.config.mjs
├─ tsconfig.json
├─ .gitignore
└─ PRD-个人展示网站.md  # 需求/技术方案存档
```

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

> 已含 `node_modules`，`npm run dev` 就是真正的一键运行，不依赖网络。

---

## 四、构建与部署

```bash
npm run build      # 产物输出到 dist/ 目录
npm run preview    # 本地预览构建后的产物
```

push 到 main 分支后，GitHub Actions 自动构建并部署到 **GitHub Pages**：
[https://fenghuajie1025.github.io](https://fenghuajie1025.github.io)

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
- 改完保存，dev 服务会热更新；构建时自动纳入站点与（二期）AI 索引。
- 排序：按 `date` 降序排列。

---

## 六、部署到国内（CloudBase / 自定义域名）

1. 注册腾讯云账号，关联 Git 仓库（或本地用 CLI 推送本目录）。
2. 构建命令填 `npm run build`，输出目录填 `dist`。
3. 默认子域名（`*.tcloudbase.com`）**免 ICP 备案**即可访问；
   想用自己的域名再单独做备案 + DNS 解析。
4. 二期 AI 查询的 API Key 只配在平台「环境变量」里，绝不进前端代码或仓库。

---

## 七、常见问题

- **端口被占用**：`npm run dev -- --port 4322`。
- **Node 版本过低**：升级到 18.17.1+（推荐 20+）。
- **换机器后跑不起来**：删除 `node_modules` 重新 `npm install`。
- **`/ask` 页面是空的**：那是二期 AI 查询的占位页，一期只做展示站。

---

## 八、二期预告（AI 知识库查询）

- 构建时把 Markdown 向量化生成索引，随部署打包（不进 public）；
- 访客在 `/ask` 提问 → 边缘函数检索相关片段 → 调国内大模型（DeepSeek 优先）生成带引用的答案；
- 详情见 `PRD-个人展示网站.md` 的「AI 查询链路（RAG）」一节。
