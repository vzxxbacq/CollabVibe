# AGENTS.md — 全局架构约束

> **⚠️ 本文件定义系统级架构不变式。任何修改必须经过人工审批。**

---

## 1. 两条数据路径（不可破坏）

系统有且仅有两条数据路径，所有功能必须沿这两条路径流动，不得绕行。

### 路径 A: 命令响应（用户消息 → 渲染结果）

```
IM Event → server.ts 分发 → feishu-message-handler（平台层）
  → intent-dispatcher（共享层）
    ├─ agent 命令 → orchestrator.handleIntent() → AgentApiPool → Factory → HandleIntentResult
    └─ 非 agent 命令 → platform-commands（共享业务逻辑）
  → FeishuOutputAdapter 渲染（平台层）
```

### 路径 B: Agent 流式事件（Agent 执行中 → 实时推送）

```
Backend (Codex stdio / ACP SSE)
  → onNotification → codexEventBridge → UnifiedAgentEvent
  → EventPipeline → AgentEventRouter → transformEvent → AgentStreamOutput 接口
  → FeishuOutputAdapter / SlackOutputAdapter（IM 输出层）
```

**关键约束：**
- 路径 A 中 `FeishuOutputAdapter` 是平台专属具体类，直接被 `src/feishu/` 调用
- 路径 B 中 `FeishuOutputAdapter` 通过 `AgentStreamOutput` 接口被 orchestrator 层调用
- Backend 差异（Codex vs ACP）在 orchestrator 内部通过 `AgentApiFactoryRegistry` 处理，对 IM 层透明

---

## 2. 层级隔离约束

```
src/core/        → 可 import: packages/*, services/*
                 → 禁止 import: src/feishu/, src/slack/

src/feishu/      → 可 import: src/core/, packages/*, services/*, channel-feishu
                 → 禁止 import: src/slack/

services/*       → 可 import: packages/*
                 → 禁止 import: src/

packages/*       → 最底层，不 import services/ 或 src/
```

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

### BackendId 枚举

```typescript
type BackendId = "codex" | "opencode" | "claude-code";
// 新增后端需同时更新 BackendId 和 BACKEND_TRANSPORT 映射
```

### 创建方式

```typescript
// ✅ 正确：通过工厂函数创建
const backend = createBackendIdentity("opencode", "MiniMax-M2.5");
// backend.transport === "acp" (自动派生)

// ❌ 禁止：手动构造或拆分字段传递
config.transport = "acp";
config.model = "MiniMax-M2.5";
config.backendName = "opencode";
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
