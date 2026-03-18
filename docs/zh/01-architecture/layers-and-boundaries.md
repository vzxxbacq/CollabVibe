---
title: 分层与边界
layer: architecture
source_of_truth: AGENTS.md, repository layout
status: active
---

# 分层与边界

## packages/*

定位：最底层能力包。

典型内容：

- 协议客户端
- 通道抽象
- 类型与工具

约束：

- 不 import `services/*`
- 不 import `src/*`

## services/*

定位：共享业务服务。

典型内容：

- orchestrator
- persistence
- iam
- approval
- audit

约束：

- 可 import `packages/*`
- 不 import `src/*`

## src/core

定位：平台无关的应用层入口逻辑。

典型内容：

- intent-dispatcher
- platform-commands

## src/feishu

定位：Feishu 平台专属接入层。

典型内容：

- 消息处理
- 卡片回调
- WS app 装配

## src/server.ts

定位：composition root。

职责：

- 初始化数据库、日志、adapter、service
- 连接 orchestrator 与平台 handler
- 绑定 Path A / Path B 的装配关系
