---
title: 国内静态站部署选项对比
tags: ["部署", "EdgeOne", "Vercel"]
date: 2026-07-20
summary: 对比 Vercel、EdgeOne Pages、CloudBase 在国内访问与成本上的差异。
draft: false
---

## 结论先行

主要访客在国内的话，优先选国内边缘/云厂商，Vercel 海外节点对国内访问不稳。

## 对比

- **EdgeOne Pages**：体验接近 Vercel，国内边缘节点快，有免费额度。
- **CloudBase**：一体化（静态+函数+存储），国内节点。
- **Vercel**：生态好但国内访问慢，适合海外受众。

## 备案提醒

用自己域名 + 国内节点做 Web 服务需 ICP 备案；默认子域可先免备案跑起来。
