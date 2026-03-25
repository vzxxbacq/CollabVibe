---
title: "系统架构"
layer: architecture
source_of_truth: AGENTS.md, src/server.ts, src/common/dispatcher.ts, services/factory.ts
status: active
---

# 系统架构

## 概述

CollabVibe 当前仍然遵守 `AGENTS.md` 里的系统级不变式：

- 系统只有两条数据路径
- 依赖方向保持 L0/L1/L2/L3 单向分层
- `projectId` 是聚合根主键
- `BackendIdentity` 是线程后端身份的唯一真实来源

但仓库里的实际目录结构，已经不是旧文档里那种 `services/contracts + services/orchestrator` 形式了。本文档记录的是**当前代码结构**。

## 1. 当前代码中的四层

```text
L0  src/server.ts, src/config.ts
L1  src/common/, src/feishu/, src/slack/
L2  services/index.ts, services/orchestrator-api.ts, services/* 领域模块, services/persistence/
L3  packages/agent-core/, packages/git-utils/, packages/logger/, packages/admin-ui/
```

### 各层职责

| 层 | 当前落点 | 职责 |
| --- | --- | --- |
| `L0` | `src/server.ts`, `src/config.ts` | 进程启动与装配 |
| `L1` | `src/common/`, `src/feishu/`, `src/slack/` | 平台接入、共享分发、平台渲染 |
| `L2` | `services/*` | 业务编排、持久化、IAM、merge、plugin、事件运行时 |
| `L3` | `packages/*` | backend 协议抽象、git 能力、日志 |

### 依赖边界

| 层 | 可以依赖 | 禁止依赖 |
| --- | --- | --- |
| `L0/L1` | `services/index.ts`、logger 公共导出 | `services/*` 内部模块、`agent-core` transport 内部、`git-utils` 内部 |
| `L2` | `packages/*` 公共入口、同层 `services/*` | `src/*` |
| `L3` | 本层内部 | `services/*`, `src/*` |

## 2. 路径 A：命令响应

当前 Path A 的实现是：

```text
IM Event
  -> src/server.ts 装配
  -> src/feishu/* 或 src/slack/*
  -> src/common/dispatcher.ts
     -> agent turn 路径：OrchestratorApi.createTurn(...)
     -> 平台命令路径：平台 handler + src/common/platform-commands.ts
  -> services/index.ts API facade
  -> L1 平台渲染
```

### 说明

- L1 不直接调用 backend transport。
- `src/common/dispatcher.ts` 是共享命令分流点。
- 项目管理、thread 管理这类平台命令虽然不一定都走 `createTurn`，但仍然走同一个 L2 API facade，不构成第三条路径。

## 3. 路径 B：Agent 流式事件

当前 Path B 是：

```text
Backend (Codex stdio / ACP)
  -> AgentApi.onNotification
  -> services/event/EventPipeline
  -> ThreadRuntimeRegistry
  -> ThreadEventRuntime
  -> AgentEventRouter
  -> transformUnifiedAgentEvent / toPlatformOutput
  -> OutputGateway
  -> Feishu / Slack adapter
```

### 关键文件

| 阶段 | 文件 |
| --- | --- |
| backend 抽象 | `packages/agent-core/src/types.ts` |
| 事件桥接 | `packages/agent-core/src/transports/*` |
| pipeline facade | `services/event/pipeline.ts` |
| thread 级运行时 | `services/event/thread-event-runtime.ts` |
| 事件路由 | `services/event/router.ts` |
| 平台输出契约 | `services/event/output-contracts.ts` |

## 4. 当前 L2 的装配方式

`services/factory.ts` 中的 `createOrchestratorLayer(...)` 当前按下面顺序装配：

1. persistence 与 project resolver
2. backend registry、config service、session resolver
3. runtime config provider 与 transport factory registry
4. API pool
5. thread / turn / snapshot 子层
6. merge / approval / IAM / audit / plugin / project service
7. 原始 `OrchestratorApi`
8. `withApiGuards(...)`
9. `runStartup(gateway)` 中再延迟装配 Path B

## 5. 仍然成立的状态不变式

### Project / Chat

- `chatId` 只是平台绑定
- `projectId` 才是聚合根主键
- 平台入口先做 `chatId -> projectId` 解引用，再访问线程和 turn

### Thread / Backend

- `ThreadRecord.backend` 是持久化的后端身份
- `UserThreadBinding` 只负责指向当前线程
- thread 运行时配置由 project 配置加 thread backend 身份组装

### Turn lifecycle

- `TurnLifecycleService` 是 turn start / finish 的权威实现
- `EventPipeline` 可以做缓冲或幂等兜底，但不是 turn 创建的唯一事实源
- merge resolver 线程在 `MERGE_HEAD` 存在时跳过普通 commit 流程

## 6. 本页为什么重写

旧版 01 架构文档大量描述的是已经不存在的目录和“目标状态”，例如：

- `services/contracts/`
- `services/orchestrator/`
- `orchestrator/intent/dispatcher`
- `src/core`

这些都和当前仓库不一致。本文现在以当前代码为准，同时继续保留 `AGENTS.md` 中的架构约束。
