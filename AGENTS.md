# AGENTS.md — 全局架构约束

> **⚠️ 本文件定义系统级架构不变式。任何修改必须经过人工审批。**

---

## 1. 两条数据路径（不可破坏）

系统有且仅有两条数据路径，所有功能必须沿这两条路径流动，不得绕行。

### 路径 A: 命令响应（用户消息 → 渲染结果）

```
IM Event → server.ts 分发 (L0)
  → feishu-message-handler (L1)
  → orchestrator/intent/dispatcher (L2)
    ├─ agent 命令 → orchestrator.handleIntent()
    │              → AgentApiPool → AgentApiFactory → HandleIntentResult
    └─ 非 agent 命令 → orchestrator/commands/platform-commands
  → FeishuOutputAdapter 渲染 (L1)
```

### 路径 B: Agent 流式事件（Agent 执行中 → 实时推送）

```
Backend (Codex stdio / ACP SSE)
  → onNotification
  → agent-core/transports/ eventBridge → UnifiedAgentEvent (L3)
  → orchestrator/event/EventPipeline → AgentEventRouter → transformEvent (L2)
  → AgentStreamOutput 接口
  → FeishuOutputAdapter / SlackOutputAdapter (L1)
```

**关键约束：**
- 路径 A 中 `FeishuOutputAdapter` 是 L1 平台专属具体类，直接被 `src/feishu/` 调用
- 路径 B 中 `FeishuOutputAdapter` 通过 `AgentStreamOutput` 接口被 orchestrator (L2) 调用
- Backend 差异（Codex vs ACP）在 `agent-core/transports/` (L3) 内部处理，对 L2 透明

---

## 2. 四层架构与隔离约束

### 层级结构

```
L0  src/        → Composition Root + Platform Modules
L1  src/feishu/, src/slack/
L2  services/   → contracts, orchestrator, persistence
L3  packages/   → agent-core, git-utils, logger, admin-ui
```

### 隔离规则

```
src/ (L0+L1)     → 可 import: services/orchestrator, services/contracts, packages/logger
                  → 禁止 import: services/persistence, packages/agent-core, packages/git-utils
                  → 禁止 import: 对方平台 (feishu ↛ slack, slack ↛ feishu)

services/ (L2)   → 可 import: packages/* (L3), 同层 services/*
                  → 禁止 import: src/ (L0+L1)

packages/ (L3)   → 最底层，禁止 import services/ 或 src/
```

### L2 三模块职责

| 模块 | 职责 | 对外暴露 |
|------|------|----------|
| **contracts** | 纯类型/接口: IM 协议 (`im/`) + 管理契约 (`admin/`) | L1 的类型依赖 |
| **orchestrator** | 业务核心: Agent 会话, Intent, Commands, IAM, Approval, Audit, Plugin | L1 的 API 入口 |
| **persistence** | 存储实现: SQLite | 仅 orchestrator 内部 DI 注入，L1 不可见 |

### L3 约束

- `agent-core` 统一后端协议，包含 `transports/codex/` 和 `transports/acp/`
- L2 通过 `AgentApiFactory` 接口访问后端，**禁止**直接 import `transports/` 内部文件
- `git-utils` 提供 diff/merge 工具，L2 可直接使用
- `logger` 是跨切面基础设施，所有层可用

---

## 3. BackendIdentity 不变式

后端身份通过 `BackendIdentity` 值对象（`packages/agent-core/src/backend-identity.ts`）表示，遵循以下规则：

| 规则 | 说明 |
|------|------|
| **I1: transport 派生** | `transport` 从 `backendId` 自动派生（`transportFor()`），**禁止独立传递或覆盖** |
| **I2: 原子传递** | 后端信息必须作为 `BackendIdentity` 整体传递，**禁止拆分为 `model` + `transport` + `backendName` 分别传递** |
| **I3: 唯一持久源** | `ThreadRecord.backend: BackendIdentity`（required）是线程后端身份的唯一真实来源 |
| **I4: 不可变** | `BackendIdentity` 创建后 `Object.freeze()`，线程的后端身份在创建后不可修改 |
| **I5: 纯指针绑定** | `UserThreadBinding` 是纯指针（`projectId`, `userId`, `threadName`, `threadId`），**禁止携带后端元数据** |

```typescript
type BackendId = "codex" | "opencode" | "claude-code";
// 新增后端需同时更新 BackendId 和 BACKEND_TRANSPORT 映射

// ✅ 正确：通过工厂函数创建
const backend = createBackendIdentity("opencode", "MiniMax-M2.5");

// ❌ 禁止：手动构造或拆分字段传递
config.transport = "acp";
config.model = "MiniMax-M2.5";
```

---

## 4. 线程状态管理

| 类型 | 作用域 | 持久源 |
|------|--------|--------|
| `ProjectRecord` | project 聚合根，可变 | `AdminStateStore` / ProjectResolver |
| `ThreadRecord` | project 级，不可变 | `ThreadRegistry`（内存/持久化） |
| `UserThreadBinding` | user 级，纯指针（归属 project） | `UserThreadBindingService` |
| `RuntimeConfig` | per-turn，临时 | `RuntimeConfigProvider` 组装 |
| `UserRecord` | 全局，可变 | `UserRepository`（SQLite `users` 表） |

**数据流向：**
```
IM chatId  →  ProjectResolver.findProjectByChatId(chatId)  →  projectId
projectId  →  ThreadRegistry.get(projectId, threadName)    →  threadRecord.backend  →  RuntimeConfig.backend
                                                            →  threadRecord.threadId  →  config.backendSessionId
```

### Project / Chat 关系不变式

| 规则 | 说明 |
|------|------|
| **P1: Project 是聚合根** | thread / turn / snapshot / thread-turn-state / user-thread-binding 的持久归属均为 `projectId` |
| **P2: Chat 只是绑定** | `chatId` 是 Project 的 1:1 平台绑定，不是线程持久化主键 |
| **P3: 平台入口先解引用** | 所有从 IM 层进入 orchestrator 的 chat 事件，先 `chatId -> projectId`，再访问线程/历史数据 |
| **P4: Thread 不跟随 Chat 迁移** | 重新绑定群聊时，thread 历史无需迁移；只更新 Project.chatId 绑定 |
| **P5: UserThreadBinding 是纯指针** | `UserThreadBinding` 只保存 `projectId/userId/threadName/threadId`，禁止携带后端元数据 |

`RuntimeConfigProvider` 从 `ProjectRecord` 读取项目运行时配置，从 `ThreadRecord` 读取线程后端身份，**不从 `UserThreadBinding` 读取后端信息**。

### 用户状态管理

| 规则 | 说明 |
|------|------|
| **U1: 双来源合并** | admin 来自 `env`（不可删）和 `im`（可增删），`UserRepository` 统一查询 |
| **U2: 唯一持久源** | `users` 表是系统级角色唯一真实来源，禁止运行时直接读 env 变量判断 admin |
| **U3: admin 全权** | admin 拥有全部权限（含用户管理），项目角色均不授予 `user.manage` |

---

## 5. 更新数据流的流程

1. 提出修改理由和影响范围
2. 获得人工审批
3. 验证所有隔离约束仍然成立

---

## 6. 测试文件变更保护

- 默认情况下，禁止修改测试用例文件（`*.test.*`, `*.spec.*`）。
- 若任务明确授权测试改造、测试迁移或测试重构，则该任务内允许修改测试文件。
- 修改测试前必须先说明：修改原因、影响层级、关联生产代码或治理目标、预期门禁变化。
- 未获明确授权时，只允许读取、分析、执行测试，不得编辑测试文件。
- 测试脚本、测试配置、fixture、snapshot 是否可改，以任务授权范围为准；不得自行假定可修改。

---

## 7. Fallback 治理约束

- **默认禁止**为主流程、身份解析、路径解析、项目/线程定位、审批/回调路由、持久化主键、后端会话恢复等关键链路**随意添加 fallback 逻辑**。
- 关键链路出现前置条件不满足、主键缺失、状态缺失、路径无法确定、上下文不一致时，**优先显式报错**，禁止用默认值、空字符串、`chatId` 兜底、全局配置兜底、静默跳过等方式继续执行。
- 禁止以 `projectId ?? chatId ?? ""`、`cwd ?? defaults.cwd`、`if (!x) return`、空 `catch`、吞错注释（如 `best-effort` / `non-critical` / `ignore`）等模式掩盖本应暴露的数据一致性问题；除非该 fallback 明确只作用于**非关键副作用**（如日志、缓存、遥测、UI 降级）。
- 若确需 fallback，必须同时满足：
  1. **说明为何不能报错**；
  2. **声明影响范围**（仅限 UI / 日志 / 缓存等非关键路径）；
  3. **记录原始错误**，不得静默吞掉；
  4. **不能改变聚合根、主键、路径、后端身份、线程绑定**等核心语义。
- 任何新增 fallback 必须在评审说明中单独列出；未说明即视为不允许。
