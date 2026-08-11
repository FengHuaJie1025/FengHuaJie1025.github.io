---
title: Astro Content Collections 实践
tags: ["前端", "Astro", "Markdown"]
date: 2026-06-03
summary: 用 Astro 的 Content Collections 管理结构化 Markdown 内容，类型安全又省心。
draft: false
---

## 为什么用 Content Collections

把 Markdown 当成"带 schema 的数据"来用，构建期就能校验 frontmatter，避免线上出错。

## 关键用法

- `defineCollection` 定义 schema（zod）。
- `getCollection('projects')` 取出全部，可在页面里排序、过滤。
- `entry.render()` 渲染正文为组件。

## 小结

适合"内容即数据"的个人站：展示页和未来的 AI 索引共用同一份源文件。
