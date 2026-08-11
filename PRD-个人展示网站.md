# 个人展示网站 + AI 知识库.

## 1. 目标
- 展示个人**项目经历**与**知识沉淀**。
- 内容同时作为**知识库**，支持 AI 自然语言查询（二期）。
- 主要访客在**国内**，因此部署与 AI 调用均在国内部署/链路内闭环。

## 2. 已确认的关键决策
| 项 | 决定 |
|---|---|
| 技术栈 | **Astro**（静态生成 + Edge Functions） |
| 内容 | Markdown 单一数据源，Git 管理 |
| 部署 | **GitHub Pages**（静态托管，默认子域名） |
| AI 查询（二期） | 云端 API + RAG，经 Edge Function 中转，密钥仅服务端 |
| 大模型（二期） | 国内 API（**DeepSeek 优先**，便宜、国内延迟低） |
| 向量库（二期） | 构建时生成，随函数部署，不进 `public/` |
| 隐私 | 内容先脱敏，全部按可公开处理 |
| 附加 | 站内全文搜索（AI 之外） |

## 3. 内容模型（Markdown 单一数据源）
- **知识沉淀** `src/content/notes/*.md`
  - frontmatter：`title` / `tags[]` / `date` / `summary?` / `draft`
  - body：正文（Markdown）
- 单一数据源：网站展示与二期 AI 索引共用同一份 Markdown。

## 4. 目录结构（提案）
```
/  (项目根 = GitHub Pages 部署根)
├─ src/
│  ├─ content/
│  │  └─ notes/      (知识沉淀 .md)
│  ├─ components/    (Header / Footer / NoteCard / ThemeToggle)
│  ├─ layouts/       (BaseLayout)
│  ├─ pages/         (首页 / notes / search / about)
│  └─ styles/        (global.css)
├─ functions/        (二期：Edge Function /api/ask)
├─ scripts/          (二期：构建时生成向量索引)
├─ public/           (favicon 等静态资源)
├─ astro.config.mjs
├─ package.json
└─ tsconfig.json
```

## 5. AI 查询链路（RAG，二期）
1. **构建时**：读取所有 Markdown → 中文友好分块 → embedding 向量化 → 生成向量索引 JSON → 随部署产物打包（不进 `public`）。
2. **运行时**：访客在 `/ask` 提问 → Edge Function `/api/ask` → 问题向量化 → 在索引中检索 top-K → 拼接上下文 + 问题发给 DeepSeek → 流式返回带引用来源的答案。
3. **兜底**：检索不到相关内容 → 回答"知识库未收录该内容"并引导浏览原文。

## 6. 展示层功能（一期范围）
- 首页：简介 + 最新文章 + AI 入口占位
- 项目经历页：卡片/网格，按技术栈筛选
- 知识沉淀页：列表 + 标签 + 搜索
- 搜索页：基于 Pagefind 的全文检索（非 AI）
- `/ask` 页：二期实现 AI 聊天窗（一期为占位）
- 全局：响应式、暗色模式、SEO 基础

## 7. 部署（GitHub Pages）
- 关联 Git 仓库，push 到 main 自动触发 GitHub Actions 构建部署
- 默认子域名：`https://fenghuajie1025.github.io`
- 自定义域名：后续买域名后绑定
- 环境变量：配置 LLM API Key（二期）

## 8. 上线步骤清单
1. 初始化 Astro 项目 + Content Collections ✅（一期）
2. 定 frontmatter schema，写示例内容 ✅（一期）
3. 展示页（首页/文章列表/详情）✅（一期）
4. 全文搜索（Pagefind）✅（一期）
5. 暗色模式 / 响应式 ✅（一期）
5. 配置 GitHub Pages，部署验证 ✅（一期）
7. 【二期】构建脚本生成向量索引
8. 【二期】Edge Function `/api/ask`（检索 + 生成）
9. 【二期】`/ask` 聊天 UI（流式）
10. 【二期】买域名 + 备案（可选）

## 9. 待确认/注意
- 二期：中文 embedding 模型选定（DeepSeek/智谱 embedding 或 bge）
- 二期：Edge 函数单次执行时长/内存上限（需实测，必要时流式）
- 是否要 RSS、评论等附加功能（待定）
- 备案时机（自定义域名时）

## 10. 成本估算
- GitHub Pages：免费版 ≈ ¥0
- 域名：~¥60/年（可选，备案后）
- LLM API（DeepSeek）：个人量 ≈ ¥0~几元/月
- 合计：基本零成本起步
