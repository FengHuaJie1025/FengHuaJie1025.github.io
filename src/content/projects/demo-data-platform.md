---
title: 实时数据可视化平台
role: 前端负责人
stack: ["React", "TypeScript", "D3.js", "WebSocket", "Node.js"]
period: "2024.03 - 2025.06"
summary: 从 0 到 1 搭建支持百万级数据点的实时可视化平台，服务内部运营与对外展示。
highlights:
  - 设计基于 WebSocket 的增量推送管线，端到端延迟 < 200ms
  - 自研虚拟滚动图表，单屏渲染 10 万+ 数据点不卡顿
  - 抽离可视化组件库，被 5 个业务线复用
links:
  - label: 演示视频
    url: "https://example.com/demo"
order: 2
draft: false
---

## 背景

业务侧需要在一个界面里同时观察多个实时指标，原有表格形式无法满足。我们决定做一套可视化平台。

## 关键技术决策

- **渲染层**：选用 D3.js 做底层绘制，React 负责结构，避免框架重渲染拖慢帧率。
- **数据层**：WebSocket 推送增量 diff，前端做补间动画，降低带宽与重绘成本。

## 复盘

最大的坑是大数据量下的交互卡顿，最终通过"分层画布 + 离屏渲染"解决。
