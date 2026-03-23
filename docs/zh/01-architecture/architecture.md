---
title: "系统架构"
layer: architecture
source_of_truth: AGENTS.md, agent/01-architecture.md
status: active
---

# 系统架构

## 概述

Codex App Server 是一个多平台 IM Bot 服务，连接飞书/Slack 等 IM 平台与 AI Agent 后端（Codex CLI / ACP 协议）。用户在群聊中发送消息，系统将其路由到 Agent 执行，并将流式结果实时推送回 IM 卡片。

系统采用 **4 层分层架构**，核心原则是**严格的单向依赖**和**层间隔离**。

---

## 1. 分层架构

```
┌────────────────────────────────────────────────────────────┐
│  L0  Composition Root                                      │
│  src/server.ts · src/config.ts · src/platform/             │
├────────────────────────────────────────────────────────────┤
│  L1  Platform Modules                                      │
│  src/feishu/ · src/slack/                                  │
├────────────────────────────────────────────────────────────┤
│  L2  Services                                              │
│  contracts · orchestrator · persistence                    │
├────────────────────────────────────────────────────────────┤
│  L3  Core Packages                                         │
│  agent-core · git-utils · logger · admin-ui                │
└────────────────────────────────────────────────────────────┘
```

### 各层职责

| 层 | 职责 | 模块 |
|---|---|---|
| **L0** | 进程启动、依赖注入、平台 bootstrap | `server.ts`, `config.ts`, `platform/` |
| **L1** | IM 平台适配：消息处理、卡片渲染、WebSocket | `src/feishu/`, `src/slack/` |
| **L2** | 平台无关的业务逻辑和类型定义 | `services/contracts/`, `services/orchestrator/`, `services/persistence/` |
| **L3** | 底层基础设施：Agent 协议、工具库 | `packages/agent-core/`, `packages/git-utils/`, `packages/logger/` |

### 隔离规则

| 源层 | 可 import | 禁止 import |
|------|-----------|-------------|
| **L0** | orchestrator factory, logger | L1 内部, L3 |
| **L1** | orchestrator, contracts, logger | L3, 对方平台模块 |
| **L2** | L3, 同层 L2 | L0, L1 |
| **L3** | 同层 (单向) | L0, L1, L2 |

### L2 三模块

| 模块 | 职责 |
|------|------|
| **contracts** | 纯类型/接口: IM 协议 (`im/`) + 管理契约 (`admin/`)，零逻辑 |
| **orchestrator** | 业务核心: Agent 会话, Intent, Commands, IAM, Approval, Audit, Plugin |
| **persistence** | 存储实现: SQLite，仅 orchestrator 通过 DI 注入 |

### L3 agent-core

统一后端协议，包含 `transports/codex/`（Codex stdio）和 `transports/acp/`（ACP SSE）。L2 通过 `AgentApiFactory` 接口访问后端，禁止直接 import `transports/` 内部文件。

---

## 2. 数据路径

系统有且仅有两条数据路径，所有功能必须沿这两条路径流动。

### 路径 A: 命令响应（用户消息 → 渲染结果）

```
IM Event
  → server.ts 分发 (L0)
  → feishu-message-handler (L1)
  → orchestrator/intent/dispatcher (L2)
    ├─ agent 命令 → orchestrator.handleIntent()
    │              → AgentApiPool → AgentApiFactory
    │              → HandleIntentResult
    └─ 非 agent 命令 → orchestrator/commands/platform-commands
  → FeishuOutputAdapter 渲染 (L1)
```

| 阶段 | 模块 | 职责 |
|------|------|------|
| 事件绑定 | `server.ts` (L0) | 绑定 IM 回调 |
| 平台解析 | `feishu-message-handler` (L1) | 解析消息/用户/内容 |
| 意图分发 | `orchestrator/intent/dispatcher` (L2) | 分类 → 授权 → 路由 |
| 非 Agent 命令 | `orchestrator/commands/` (L2) | `/thread`, `/help`, 项目管理等 |
| Agent 命令 | `orchestrator.handleIntent()` (L2) | 线程/后端/Turn/管道 |
| 平台输出 | `FeishuOutputAdapter` (L1) | 渲染飞书消息和卡片 |

### 路径 B: Agent 流式事件（Agent 执行中 → 实时推送）

```
Backend (Codex stdio / ACP SSE)
  → onNotification
  → agent-core/transports/ eventBridge (L3)
  → UnifiedAgentEvent
  → orchestrator/event/EventPipeline (L2)
  → AgentEventRouter → transformEvent
  → AgentStreamOutput 接口
  → FeishuOutputAdapter / SlackOutputAdapter (L1)
```

| 阶段 | 模块 | 职责 |
|------|------|------|
| 后端集成 | `agent-core/transports/` (L3) | 连接 Codex/ACP 协议 |
| 事件统一 | `UnifiedAgentEvent` (L3) | 统一事件模型 |
| 事件编排 | `orchestrator/event/` (L2) | 管道、路由、回调 |
| 平台推送 | Output Adapter (L1) | 转化为平台消息 |

### 设计约束

| 约束 | 说明 |
|------|------|
| 路径 A 必须经过 `intent/dispatcher` | 统一命令入口 |
| 路径 B 必须经过 `EventPipeline` | 统一流式事件入口 |
| L1 禁止直接调用后端 | 后端差异在 L3 内部处理 |
| 新平台不得新增第三条路径 | 复用路径 A / B |

### Turn lifecycle 语义

- `turn/start` 成功返回 `turnId` 后，L2 `TurnLifecycleService` 必须立即建立 turn 基线：创建 turn record、写入初始 snapshot、标记 active turn。
- `EventPipeline` 属于路径 B 的流式同步层，只负责实时事件收敛、状态同步与完成态收尾；它不是 turn start persistence 的唯一真实来源。
- 为处理后端事件早到竞态，`EventPipeline` 可以防御性调用幂等的 `ensureTurnStarted()`，并在 turn 尚未激活前缓冲通知；这不会改变权威起点仍在 `TurnLifecycleService` 的事实。
- `finishTurn()` 只能基于已建立的 active turn 计算 commit/diff；因此 turn-start persistence 缺失属于生命周期错误，不能靠 UI fallback 掩盖。

---

## 3. 核心不变式

### 3.1 BackendIdentity

| 规则 | 说明 |
|------|------|
| **I1** | `transport` 从 `backendId` 自动派生，禁止独立传递 |
| **I2** | 必须作为 `BackendIdentity` 整体传递，禁止拆分 |
| **I3** | `ThreadRecord.backend` 是唯一持久源 |
| **I4** | 创建后 `Object.freeze()`，不可修改 |
| **I5** | `UserThreadBinding` 是纯指针，禁止携带后端元数据 |

### 3.2 Project / Chat 关系

| 规则 | 说明 |
|------|------|
| **P1** | Project 是聚合根 |
| **P2** | `chatId` 是平台绑定，不是持久化主键 |
| **P3** | IM 入口先 `chatId → projectId` 解引用 |
| **P4** | 重绑群聊时 thread 历史不迁移 |
| **P5** | `UserThreadBinding` 纯指针 |

### 3.3 线程状态模型

| 类型 | 作用域 | 持久源 |
|------|--------|--------|
| `ProjectRecord` | project 聚合根 | `AdminStateStore` |
| `ThreadRecord` | project 级，不可变 | `ThreadRegistry` |
| `UserThreadBinding` | user 级，纯指针 | `UserThreadBindingService` |
| `RuntimeConfig` | per-turn | `RuntimeConfigProvider` |
| `UserRecord` | 全局 | `UserRepository` (SQLite) |

### 3.4 用户状态

| 规则 | 说明 |
|------|------|
| **U1** | admin 双来源合并 (`env` + `im`) |
| **U2** | `users` 表是角色唯一持久源 |
| **U3** | admin 拥有全部权限 |

---

## 4. 平台扩展规则

### 新增平台最小契约

新 IM 平台须提供：
- Path A 消息 → 输入适配器
- 交互回调 → 命令适配器
- `IMOutputAdapter` 实现（Path B + 结构化 Path A 输出）

禁止：
- 在平台层持久化 thread/backend 状态
- 绕过 `dispatchIntent()` 或 `EventPipeline`
- 向共享层泄露平台 payload 结构

### 新增后端

- 扩展 `agent-core/transports/` 新增 transport
- 更新 `BackendId` 枚举 + `BACKEND_TRANSPORT` 映射
- L2 层零改动

---

## 5. 治理约束

### Fallback 治理

关键链路优先显式报错，禁止静默 fallback。若确需 fallback，必须：声明仅限非关键路径、记录原始错误、不改变核心语义。

### 测试文件保护

默认禁止修改 `*.test.*`。需明确授权 + 说明后方可修改。

### 架构变更

提出理由 → 人工审批 → 验证隔离约束。
