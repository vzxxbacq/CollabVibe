---
title: 分层与边界
layer: architecture
source_of_truth: AGENTS.md, src/server.ts, services/index.ts, packages/*/src/index.ts
status: active
---

# 分层与边界

## 当前目录分层

```text
src/
  server.ts
  common/
  feishu/
  slack/

services/
  index.ts
  orchestrator-api.ts
  project/
  thread/
  turn/
  event/
  merge/
  iam/
  plugin/
  snapshot/
  backend/
  approval/
  audit/
  persistence/

packages/
  agent-core/
  git-utils/
  logger/
  admin-ui/
```

## `packages/*`

定位：L3 最底层能力包。

典型内容：

- backend 协议抽象
- git 操作封装
- 日志基础设施

约束：

- 不 import `services/*`
- 不 import `src/*`

## `services/*`

定位：L2 共享业务层。

典型内容：

- `services/orchestrator-api.ts`：L2 公共 API 契约
- `services/index.ts`：L1 唯一允许依赖的 L2 入口
- `services/project/*`、`thread/*`、`turn/*`、`event/*`：领域服务
- `services/persistence/*`：SQLite 持久化

约束：

- 可 import `packages/*` 公共入口
- 不 import `src/*`

## `src/common`

定位：L1 共享平台层，不是 L2。

典型内容：

- `dispatcher.ts`
- `intent-router.ts`
- `platform-commands.ts`
- 平台共享类型与 registry

职责：

- 做平台无关但仍属于入口层的消息分类和命令分发
- 调用 `services/index.ts` 暴露的公共 API

## `src/feishu` / `src/slack`

定位：平台专属接入层。

典型内容：

- 消息处理
- 卡片或交互回调
- 平台输出 adapter
- 平台 bootstrap module

约束：

- 不直接依赖 backend transport
- 不直接依赖 `services/*` 内部模块
- 只通过 `services/index.ts` 调用 L2

## `src/server.ts`

定位：Composition Root。

职责：

- 加载配置和日志
- 调用 `createOrchestratorLayer(...)`
- 选择并启动平台 module
- 在 `runStartup(gateway)` 中把 L2 Path B 接到 L1 输出网关
