---
title: RAG 检索增强生成入门笔记
tags: ["AI", "RAG", "LLM"]
date: 2026-05-12
summary: 记录 RAG 的基本链路：切分、向量化、检索、重排、生成，以及中文场景下的坑。
draft: false
---

## 什么是 RAG

RAG（Retrieval-Augmented Generation）让大模型先"查资料"再回答，缓解幻觉、引入私有知识。

## 链路

1. **切分（chunk）**：把文档切成片段，中文不能按空格切，要按标点/语义。
2. **向量化（embedding）**：用中文友好的 embedding 模型。
3. **检索**：问题向量与片段向量做相似度检索，取 top-K。
4. **重排（rerank）**：对 top-K 再精排，提升精度。
5. **生成**：把片段拼进 prompt 让 LLM 生成，并标注引用。

## 中文坑

- 分块太大 retrieves 不准，太小丢失上下文。
- embedding 模型要用支持中文的，否则语义漂移。
