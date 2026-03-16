---
title: 调用链与数据流
layer: architecture
source_of_truth: AGENTS.md, src/server.ts, src/feishu/*, services/orchestrator/*
status: active
---

# 调用链与数据流

系统只保留两条主路径：命令响应路径和流式事件路径。

![两条数据路径占位图](/placeholders/guide-image-placeholder.svg)

> Placeholder：在这里插入 Path A / Path B 双通路架构图。

## 路径总览

| 路径 | 入口 | 终点 | 作用 |
| --- | --- | --- | --- |
| Path A | IM 消息 / 卡片事件 | 平台渲染结果 | 命令响应 |
| Path B | Backend 事件 | 平台实时推送 | 流式执行反馈 |

## Path A：命令响应路径

```text
IM Event
→ src/server.ts
→ src/feishu/*
→ src/core/intent-dispatcher.ts
→ platform-commands / orchestrator.handleIntent()
→ packages/channel-feishu/FeishuOutputAdapter
```

### Feishu 实现落点

| 阶段 | 模块 | 责任 |
| --- | --- | --- |
| 事件绑定 | `src/server.ts` | 绑定 `im.message.receive_v1`、`card.action.trigger` 等回调 |
| 平台解析 | `src/feishu/feishu-message-handler.ts` | 解析消息、提取 chat/user/content、mention 过滤、去重 |
| 卡片处理 | `src/feishu/feishu-card-handler.ts` | 解析 action value、执行卡片命令、处理审批 |
| 共享分流 | `src/core/intent-dispatcher.ts` | 分类 intent、鉴权、决定是否进入 orchestrator |
| 非 agent 命令 | `src/core/platform-commands.ts` | 处理共享业务命令 |
| agent 命令 | `services/orchestrator` | 处理 thread、backend、turn、pipeline |
| 平台输出 | `packages/channel-feishu` | 渲染 Feishu 消息与卡片 |

## Path B：Agent 流式事件路径

```text
Backend (Codex stdio / ACP)
→ event bridge
→ UnifiedAgentEvent
→ EventPipeline
→ AgentEventRouter
→ FeishuOutputAdapter / SlackOutputAdapter
```

### 核心部件

| 阶段 | 模块 | 责任 |
| --- | --- | --- |
| backend 接入 | `packages/codex-client`, `packages/acp-client` | 连接不同 backend 协议 |
| transport 收敛 | `packages/agent-core/BackendIdentity` | 屏蔽 transport 差异 |
| 统一事件 | `UnifiedAgentEvent` | 将 Codex / ACP 事件映射为统一模型 |
| 事件编排 | `services/orchestrator/src/event/*` | 事件管线、路由、turn 完成回调 |
| 平台推送 | `packages/channel-feishu`, `packages/channel-slack` | 将统一事件转换为平台输出 |

## 平台接入策略

| 平台 | Path A | Path B | 状态 |
| --- | --- | --- | --- |
| Feishu | 已接入 | 已接入 | 当前主平台 |
| Slack | 待接入应用层 | 已有输出基础 | 规划中 |

## backend 接入策略

| backend | 选择位置 | 平台层是否感知 transport |
| --- | --- | --- |
| Codex | `AgentApiFactoryRegistry` | 否 |
| OpenCode | `AgentApiFactoryRegistry` | 否 |
| Claude Code | `AgentApiFactoryRegistry` | 否 |

## 设计约束

| 约束 | 说明 |
| --- | --- |
| Path A 不绕过 `intent-dispatcher` | 命令入口统一 |
| Path B 不绕过 `EventPipeline` | 流式事件入口统一 |
| 平台层不直接调用 backend client | backend 差异留在 orchestrator 内部 |
| 新平台不新增第三条路径 | 复用 Path A / Path B |
