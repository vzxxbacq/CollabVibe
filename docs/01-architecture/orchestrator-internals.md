# L2 内部架构（目标状态）

> [!CAUTION]
> 本文档描述 L2 orchestrator 的**目标架构**，是 `core-api.md` 的内部实现参考。
> L3 各包的内部结构见 [`l3-internals.md`](file:///home/yindu/CollabVibe/docs/01-architecture/l3-internals.md)。
> 当前实现与目标存在差距（见末尾「现状 → 目标 差异表」）。

---

## 1. 设计原则

| 原则 | 说明 |
|------|------|
| **API Facade** | `OrchestratorApi` 是唯一对外接口，内部由独立 service 实现 |
| **每个 § 一个 Service** | core-api.md §0–§9 各对应一个 service 类 |
| **Service 无状态** | 状态交给 Repository（持久）和 Registry（内存） |
| **单一入口工厂** | `createOrchestratorLayer()` 创建所有 service 并组装 API |
| **DI 注入** | Service 通过构造函数注入依赖，不 import 具体实现 |

---

## 2. Service 图谱

```
OrchestratorApi (Facade)
 ├── §0 ProjectService
 ├── §1 ThreadService
 ├── §2 TurnLifecycleService
 ├── §3 TurnDataService
 ├── §4 SnapshotService
 ├── §5 MergeService
 ├── §6 BackendService
 ├── §7 IamService
 ├── §8 SkillService
 ├── §9 ApprovalService
 └── [横切] ApiGuard (Proxy 拦截层)

EventPipeline (路径 B — 独立于 API Facade)
 ├── AgentEventRouter
 ├── PlanFinalizer
 └── → OutputGateway (L1 提供)
```

### 2.1 Service 职责与依赖

| Service | 职责 | 依赖的 Repository | 依赖的 L3 |
|---------|------|-------------------|-----------|
| **ProjectService** | 项目 CRUD、绑定/解绑、停用/恢复 | `AdminStateStore` | — |
| **ThreadService** | 线程创建/删除、用户绑定切换、列表 | `ThreadRegistry`, `UserThreadBindingRepo` | `git-utils/worktree` |
| **TurnLifecycleService** | turn 发起/中断/接受/回滚、git snapshot | `TurnRepository`, `SnapshotRepository` | `agent-core/AgentApiPool`, `git-utils/snapshot` |
| **TurnDataService** | turn 数据查询/更新、事件追加、状态同步 | `TurnRepository`, `TurnDetailRepository`, `ThreadTurnStateRepository` | — |
| **SnapshotService** | 快照列表、跳转、diff | `SnapshotRepository` | `git-utils/snapshot` |
| **MergeService** | 合并/预览/审查/冲突解决 | `MergeSessionRepository` | `git-utils/merge` |
| **BackendService** | 后端列表/解析/配置/健康检查 | (file-based config) | `agent-core/BackendIdentity` |
| **IamService** | 角色解析、admin 管理、成员管理 | `UserRepository`, `AdminStateStore` | — |
| **SkillService** | 技能目录/安装/绑定；插件变更时同步所有 worktree 符号链接 | `PluginCatalogStore` | `git-utils/worktree`（`ensurePluginSymlink`） |
| **ApprovalService** | 审批回调路由 | `ApprovalStore` | — |

### 2.2 共享基础设施

| 组件 | 职责 | 所在层 |
|------|------|--------|
| **AgentApiPool** | agent 后端会话池（创建/复用/销毁 AgentApi 实例） | L2 session/ |
| **FactoryRegistry** | transport-aware 工厂注册（codex ↔ stdio, acp ↔ SSE） | L2 session/ |
| **ConversationStateMachine** | per-thread 状态机（IDLE→RUNNING→AWAITING_APPROVAL→IDLE） | L2 session/ |
| **RuntimeConfigProvider** | 运行时配置组装（project + thread + backend → RuntimeConfig） | L2 backend/ |
| **EventPipeline** | 路径 B 流式事件处理、throttle、turn 状态收集 | L2 event/ |
| **ApiGuard** | 鉴权 + 审计 Proxy 拦截层 | L2 api/ [NEW] |

---

## 3. API → Service 映射

| core-api.md 方法 | 目标 Service | 当前实现位置 |
|-----------------|-------------|-------------|
| **§0** | | |
| `resolveProjectId` | ProjectService | `ProjectResolver` |
| `getProjectRecord` | ProjectService | `AdminStateStore` 直读 |
| `createProject` | ProjectService | `ProjectSetupService` + `platform-commands.ts` (L1!) |
| `linkProjectToChat` | ProjectService | `ProjectSetupService` |
| `unlinkProject` | ProjectService | `ProjectSetupService` |
| `disableProject` | ProjectService | `ProjectSetupService` |
| `reactivateProject` | ProjectService | `ProjectSetupService` |
| `deleteProject` | ProjectService | **不存在** [NEW] |
| `listProjects` | ProjectService | `AdminStateStore` 直读 |
| `listUnboundProjects` | ProjectService | `AdminStateStore` 直读 |
| `updateGitRemote` | ProjectService | `ProjectSetupService` |
| `updateProjectConfig` | ProjectService | `orchestrator.ts` + `AdminStateStore` 直写 |
| `onProjectDeactivated` | ~~ProjectService~~ | **删除**: L1 调用 `disableProject()`，不单独暴露 |
| `recoverSessions` | ~~ProjectService~~ | **内部**: `runStartup` 自动调用 |
| **§1** | | |
| `createThread` | ThreadService | `orchestrator.ts:703` (100 lines) |
| `joinThread` | ThreadService | `orchestrator.ts:808` |
| `leaveThread` | ThreadService | `orchestrator.ts:819` |
| `listThreads` | ThreadService | `orchestrator.ts:830` |
| `deleteThread` | ThreadService | `ThreadRuntimeService` |
| `getUserActiveThread` | ThreadService | `orchestrator.ts:487` |
| `getThreadRecord` | ThreadService | `orchestrator.ts:497` |
| `isPendingApproval` | ThreadService | `orchestrator.ts:1069` |
| **§2** | | |
| `createTurn` | TurnLifecycleService | `orchestrator.ts:842` (140 lines!) |
| `recordTurnStart` | TurnLifecycleService | `TurnCommandService` |
| `interruptTurn` | TurnLifecycleService | `orchestrator.ts:1079` |
| `acceptTurn` | TurnLifecycleService | `TurnCommandService` |
| `revertTurn` | TurnLifecycleService | `TurnCommandService` |
| `respondUserInput` | TurnLifecycleService | `orchestrator.ts:1244` |
| **§3** | | |
| `getTurnDetail` | TurnDataService | `TurnQueryService` ✅ |
| `getTurnCardData` | TurnDataService | `TurnQueryService` ✅ |
| `listTurns` | TurnDataService | `TurnQueryService` ✅ |
| `updateTurnSummary` | TurnDataService | `TurnCommandService` ✅ |
| `updateTurnMetadata` | TurnDataService | `TurnCommandService` ✅ |
| `appendTurnEvent` | TurnDataService | `TurnCommandService` ✅ |
| `syncTurnState` | TurnDataService | `TurnCommandService` ✅ |
| `finalizeTurnState` | TurnDataService | `TurnCommandService` ✅ |
| **§4** | | |
| `listSnapshots` | SnapshotService | `SnapshotService` ✅ |
| `jumpToSnapshot` | SnapshotService | `orchestrator.ts:1117` (需迁移) |
| `updateSnapshotSummary` | SnapshotService | `SnapshotService` ✅ |
| `getSnapshotDiff` | SnapshotService | `orchestrator.ts:1107` (需迁移) |
| **§5** | | |
| `handleMerge` ~ `retryMergeFiles` | MergeService | `MergeUseCase` ✅ |
| `pushWorkBranch` | MergeService | `orchestrator.ts` 委托 |
| `detectStaleThreads` | MergeService | `ThreadRuntimeService` |

> [!WARNING]
> `handleMerge`/`handleMergeConfirm`/`handleMergeWithConflictResolver` 当前返回 `HandleIntentResult`（intent 层类型）。
> 目标架构已定义 L2 原生返回类型 `MergeResult`（6-variant），在 `services/contracts` 中声明。
> L1 自行映射 `MergeResult` → UI 指令。详见 TODO 19 §5 和 core-api.md §5。
| **§6** | | |
| `listAvailableBackends` ~ `adminDeleteProfile` | BackendService | `BackendAdminService` + `orchestrator.ts` 代理 |
| `checkBackendHealth` | BackendService | **不存在** [NEW] |
| **§7** | | |
| `resolveRole` | IamService | `RoleResolver` ✅ |
| `isAdmin` ~ `listAdmins` | IamService | `UserRepository` 直读 |
| `addProjectMember` ~ `listProjectMembers` | IamService | `AdminStateStore` 直操作 |
| `listUsers` | IamService | `UserRepository` ✅ |
| **§8** | | |
| `listSkills` ~ `allocateStagingDir` | SkillService | `PluginService` ✅ |
| **§9** | | |
| `handleApprovalCallback` | ApprovalService | `ApprovalUseCase` ✅ |

---

## 4. Persistence 层

| Repository（接口） | SQLite 实现 | 被谁依赖 |
|---------------------|------------|---------|
| `AdminStateStore` | `SqliteAdminStateStore` | ProjectService, IamService |
| `ThreadRegistry` | `SqliteThreadRegistry` | ThreadService |
| `UserThreadBindingRepo` | `SqliteUserThreadBindingRepo` | ThreadService |
| `TurnRepository` | `SqliteTurnRepository` | TurnLifecycleService, TurnDataService |
| `TurnDetailRepository` | `SqliteTurnDetailRepository` | TurnDataService |
| `SnapshotRepository` | `SqliteSnapshotRepository` | SnapshotService |
| `ThreadTurnStateRepository` | `SqliteThreadTurnStateRepository` | TurnDataService |
| `MergeSessionRepository` | `SqliteMergeSessionRepository` | MergeService |
| `UserRepository` | `SqliteUserRepository` | IamService |
| `ApprovalStore` | `SqliteApprovalStore` | ApprovalService |
| `AuditLogRepository` | `SqliteAuditStore` | ApiGuard |
| `PluginCatalogStore` | `SqlitePluginCatalogStore` | SkillService |

---

## 5. Service → L3 Import API 表

> 每个 Service 允许 import 的 L3 API 的完整清单。
> Service 只通过 L3 公开 API（`index.ts`）import，不直接引用内部文件。
> 详见 [`l3-internals.md`](file:///home/yindu/CollabVibe/docs/01-architecture/l3-internals.md)

### 5.1 agent-core imports

| Service | 导入的函数/类型 | 来源模块 |
|---------|---------------|---------|
| **ProjectService** | — | — |
| **ThreadService** | `BackendIdentity` (type), `createBackendIdentity()`, `isBackendId()` | `backend-identity` |
| | `AgentApiPool` (type), `RuntimeConfig` (type), `AgentApi` (type) | `types` |
| | `createDefaultTransportFactories()` | `index` (通过 FactoryRegistry) |
| **TurnLifecycleService** | `AgentApi` (type), `ApprovalAwareAgentApi` (type), `RuntimeConfig` (type), `TurnInputItem` (type) | `types` |
| | `BackendIdentity` (type), `BackendId` (type), `createBackendIdentity()` | `backend-identity` |
| **TurnDataService** | — | — |
| **SnapshotService** | — | 通过 `git-utils` 间接 |
| **MergeService** | `AgentApi` (type), `RuntimeConfig` (type) | `types` |
| | `createBackendIdentity()`, `isBackendId()` | `backend-identity` |
| **BackendService** | `BackendIdentity` (type), `BackendId` (type), `TransportType` (type) | `backend-identity` |
| | `BackendConfigData` (type), `BackendCmdResult` (type) | `backend-config-types` |
| | `createBackendIdentity()`, `isBackendId()` | `backend-identity` |
| **IamService** | — | — |
| **SkillService** | — | — |
| **ApprovalService** | `AgentApi` (type) | `types` |
| **[共享] FactoryRegistry** | `AgentApiFactory` (type), `AgentApi` (type), `RuntimeConfig` (type) | `types` |
| **[共享] AgentApiPool** | `AgentApi` (type), `AgentApiPool` (type), `RuntimeConfig` (type), `AgentApiFactory` (type) | `types` |
| | `AgentProcessManager` (type) | `agent-process-manager` |
| **[共享] RuntimeConfigProvider** | `RuntimeConfigProvider` (type), `RuntimeConfig` (type) | `types` |
| | `createBackendIdentity()` | `backend-identity` |
| **[共享] EventPipeline** | `UnifiedAgentEvent` (type) | `unified-agent-event` |

### 5.2 git-utils imports

| Service | 导入的函数/类型 | 来源模块 |
|---------|---------------|---------|
| **ProjectService** | `initRepo()`, `detectDefaultBranch()`, `ensureWorkBranch()` | `repo` |
| **ThreadService** | `createWorktree()`, `removeWorktree()`, `getWorktreePath()`, `getHeadSha()`, `fastForwardWorktree()` | `worktree` |
| | `ensurePluginSymlink()`, `listWorktrees()` | `worktree` |
| **TurnLifecycleService** | `createSnapshot()`, `restoreSnapshot()`, `pinSnapshot()` | `snapshot` |
| | `commitAndDiffWorktreeChanges()`, `isWorktreeDirty()` | `commit` |
| | `TurnDiffResult` (type) | `commit` |
| **TurnDataService** | `parseDiffFileNames()`, `parseDiffStats()` | `diff-parser` |
| **SnapshotService** | `diffSnapshot()`, `restoreSnapshot()` | `snapshot` |
| | `SnapshotDiff` (type) | `snapshot` |
| **MergeService** | `dryRunMerge()`, `mergeWorktree()`, `startConflictMerge()`, `checkConflictsResolved()` | `merge` |
| | `startMergeSession()`, `applyFileDecision()`, `commitMergeSession()`, `abortMergeSession()` | `merge` |
| | `fastForwardMain()`, `commitWorktreeChanges()`, `readCachedFileDiff()`, `readWorktreeStatusMap()` | `merge` |
| | `MergeDiffStats` (type), `DryRunMergeResult` (type), `MergeFileInfo` (type), `MergeSessionResult` (type) | `merge` |
| | `MergeLogContext` (type) | `merge-log-schema` |
| | `createWorktree()`, `removeWorktree()`, `getWorktreePath()`, `assertWorktreeValid()` | `worktree` |
| | `createSnapshot()`, `pinSnapshot()` | `snapshot` |
| | `getCurrentBranch()` | `repo` |
| **BackendService** | — | — |
| **IamService** | — | — |
| **SkillService** | `ensurePluginSymlink()` | `worktree` |
| **ApprovalService** | — | — |

### 5.3 logger imports

| Service | 导入 |
|---------|-----|
| 所有 Service + 共享基础设施 | `createLogger(name)` |

### 5.4 Service 间依赖

| Service | 依赖的其他 Service / 共享组件 |
|---------|---------------------------|
| **ProjectService** | `ThreadService`（`recoverSessions` 需恢复线程） |
| **ThreadService** | `AgentApiPool`（创建/释放后端会话）, `RuntimeConfigProvider`（组装运行时配置）, `ConversationStateMachine`（状态机） |
| **TurnLifecycleService** | `ThreadService`（获取活跃线程）, `AgentApiPool`（获取 API）, `ConversationStateMachine`（状态机）, `EventPipeline`（激活路径 B） |
| **TurnDataService** | — |
| **SnapshotService** | `ThreadService`（获取 worktree 路径） |
| **MergeService** | `ThreadService`（获取 worktree）, `AgentApiPool`（冲突解决 agent）, `EventPipeline`（resolver 输出） |
| **BackendService** | — |
| **IamService** | — |
| **SkillService** | — |
| **ApprovalService** | `AgentApiPool`（发送审批响应） |

### 5.5 目标状态（与现状差异）

| 问题 | 影响 L2 | 修复方案 |
|------|---------|---------|
| `AgentApiPool` 接口用 `chatId` | `DefaultAgentApiPool` 所有调用点 | 改为 `projectId`，与 L2 `chatId → projectId` 迁移同步 |
| `git-utils/merge.ts` import `services/contracts` | `MergeService` 消费 `MergeFileStatus` 类型 | 类型下沉到 `git-utils`，L2 contracts re-export |
| `index.ts` 直接导出 `CodexProtocolApiFactory` | `FactoryRegistry` 可能直接 import | L2 统一走 `createDefaultTransportFactories()` |

---

## 6. 生命周期

```
createOrchestratorLayer(config)
  │
  ├─ 创建 DB + PersistenceLayer（12 个 repository）
  ├─ 创建 L3 基础设施（FactoryRegistry, AgentApiPool）
  ├─ 创建 10 个 Service（见 §2.1）
  ├─ 组装 OrchestratorApi（委托到各 Service）
  ├─ 包装 ApiGuard（withApiGuards proxy）
  └─ 返回 OrchestratorLayer { api, runStartup, shutdown }

layer.runStartup(gateway)
  │
  ├─ 绑定 EventPipeline → gateway（路径 B 推送目标）
  ├─ 启动健康检查定时器（每 10 分钟）
  ├─ backfill 项目元数据（gitUrl, defaultBranch）
  └─ 恢复活跃项目的 agent 会话

layer.shutdown()
  │
  ├─ 停止健康检查定时器
  ├─ 释放所有 agent 会话
  └─ 关闭 DB
```

---

## 7. Session 管理

```
TurnLifecycleService.createTurn()
  │
  ├─ ThreadService.getUserActiveThread() → threadRecord
  ├─ AgentApiPool.getOrCreate(threadRecord) → AgentApi
  ├─ ConversationStateMachine.startTurn() → 检查 IDLE
  ├─ AgentApi.sendMessage(text) → turnId
  ├─ EventPipeline.activate(route) → 开始接收流式事件
  └─ 返回 { turnId }

EventPipeline（路径 B）
  │
  ├─ L3 transport onNotification → UnifiedAgentEvent
  ├─ AgentEventRouter.route(event) → 分类
  ├─ transformer.transform(event) → IMOutputMessage
  ├─ TurnDataService.appendTurnEvent() → 持久化
  └─ OutputGateway.send(message) → L1 渲染
```

### 7.1 EventPipeline 内部机制

> EventPipeline 是路径 B 的核心，管理事件流的生命周期。

| 机制 | 方法 | 说明 |
|------|------|------|
| **两阶段 Turn 激活** | `prepareTurn(route)` → `activateTurn(route)` | 先 prepare 设置元数据（threadName、userId），再 activate 绑定 L3 transport source 并开始事件转发 |
| **Turn-completion hooks** | `registerTurnCompleteHook(chatId, threadName, hook)` | MergeService 注册回调，在 turn 完成时触发 merge 后续操作 |
| **事件去重** | `finishedTurns` Map + TTL | 防止 `turn_complete` 事件重复处理（重复事件在 TTL 内静默丢弃） |
| **元数据更新** | `updateTurnMetadata(chatId, turnId, metadata)` | Pipeline 内部更新 turn 元数据（backendName、modelName），供事件路由使用 |

**Turn 生命周期完整流程**：

```
prepareTurn(route)        → 设置 pendingTurn = { chatId, threadName, userId }
activateTurn(route)       → 绑定 L3 source.onNotification → Pipeline
  ↓ 事件流 ↓
  content_delta           → Router → OutputGateway
  tool_begin / tool_end   → Router → OutputGateway
  approval_request        → registerApprovalRequest() → StateMachine.AWAITING_APPROVAL
  turn_complete           → finishTurn() → StateMachine.IDLE + TurnDataService 持久化
  notification            → Router → OutputGateway（不创建额外消息）
```

**事件映射表**（`UnifiedAgentEvent.type` → `PlatformOutput.kind`）：

| L3 事件类型 | L2 处理 | → PlatformOutput kind |
|-----------|--------|---------------------|
| `content_delta` | Router 直转 | `content` |
| `reasoning_delta` | Router 直转 | `reasoning` |
| `plan_delta` | Router 直转 | `plan` |
| `plan_update` | Router 直转 | `plan_update` |
| `tool_output` | Router 直转 | `tool_output` |
| `tool_begin`/`tool_end` | Router 直转 | `progress` |
| `approval_request` | `registerApprovalRequest()` + StateMachine | `approval_request` |
| `user_input` | Router 直转 | `user_input_request` |
| `turn_started` | 状态机 IDLE→RUNNING | （无 output） |
| `turn_complete` | `finishTurn()` + 状态机→IDLE | `turn_summary` |
| `turn_aborted` | 状态机→INTERRUPTED | `error` |
| `token_usage` | `updateTurnSummary()` | （无 output，持久化用） |
| `notification` (category=error) | Router 分流 | `error` |
| `notification` (其他 category) | Router 直转 | `notification` |

**L2 内部产生的事件**（非 L3 来源，由 L2 自行 dispatch 到 OutputGateway）：

| L2 来源 | → PlatformOutput kind | 触发时机 |
|---------|----------------------|----------|
| `MergeService.onMergeResolverDone` | `merge_event` (action=resolver_done) | agent 冲突解析完成 |
| `factory.ts` `onResolverComplete` | `merge_event` (action=resolver_complete) | resolver 线程完成 |
| `MergeService.scheduleSessionTimeout` | `merge_event` (action=timeout) | 合并超时 |
| `OrchestratorError` (异步路径) | `error` | L2 内部异步错误 |

### 7.2 ConversationStateMachine

> 每个 `projectId:threadName` 对维护独立的状态机实例。

```
状态转换图：

IDLE ──→ RUNNING ──→ IDLE                 （turn 正常完成）
  │         │
  │         ├──→ AWAITING_APPROVAL ──→ RUNNING  （审批通过后继续）
  │         │                          ↘ INTERRUPTED ──→ IDLE
  │         │
  │         ├──→ INTERRUPTED ──→ IDLE   （用户中断）
  │         │                  ↘ RUNNING（中断后重试）
  │         │
  │         └──→ FAILED ──→ IDLE        （异常后自动恢复）
  │
  └──→ FAILED ──→ IDLE / RUNNING        （启动时恢复）
```

**关键方法**：
- `ensureCanStartTurn(key)` — 检查 IDLE + 转 RUNNING（AWAITING_APPROVAL 时抛错，RUNNING 时抛错或允许并发）
- `finishSessionTurn(key)` — RUNNING → IDLE
- `releaseFailedStartTurn(key)` — RUNNING → FAILED → IDLE（turn 启动失败后的安全恢复）

**状态转换表**（完整，源自 `state-machine.ts`）：

| 当前状态 | 允许转换到 |
|---------|----------|
| IDLE | RUNNING, FAILED |
| RUNNING | IDLE, AWAITING_APPROVAL, INTERRUPTED, FAILED |
| AWAITING_APPROVAL | RUNNING, INTERRUPTED, FAILED |
| INTERRUPTED | IDLE, RUNNING, FAILED |
| FAILED | IDLE, RUNNING |

### 7.3 Session 恢复机制

> `recoverSessions(activeProjectIds)` 在服务启动时恢复所有活跃线程的 agent 会话。

**恢复流程**：

```
recoverSessions(projectIds)
  │
  ├─ 遍历所有 ThreadRecord（按 projectId 过滤）
  │   └─ 对每个线程调用 recoverThreadSession()
  │       ├─ ThreadRuntimeService.getOrCreateForExistingThread() → AgentApi
  │       └─ 失败时分类错误 → classifyRecoveryFailure()
  │
  └─ MergeUseCase.recoverSessions(projectIds) → 恢复 merge 会话
```

**错误分类（5 类）**：

| 类别 | 说明 |
|------|------|
| `CONFIG_ERROR` | 后端配置缺失或无效 |
| `BACKEND_SESSION_MISSING` | 后端进程已退出，会话不可恢复 |
| `WORKTREE_MISSING` | Git worktree 目录不存在 |
| `SKILL_SYNC_FAILED` | 技能符号链接同步失败 |
| `UNKNOWN` | 其他未分类错误 |

**Turn 级恢复（createTurn 内部）**：

| 场景 | 恢复逻辑 |
|------|---------|
| **Thread lost**（后端返回 "thread not found"） | 尝试 `api.threadResume(threadId, runtimeConfig)` |
| **Resume 失败 + 空线程**（Codex 无 rollout） | `reinitializeEmptyCodexThread()` — 重新 `threadStart` + 更新 ThreadRecord |
| **Resume 返回不同 threadId** | 拒绝：不修改 ThreadRecord identity，抛 RESUME_NOT_SUPPORTED |

---

## 8. 目标 OrchestratorLayer 结构

```typescript
// factory.ts — 目标状态
export interface OrchestratorLayer {
  api: OrchestratorApi;                    // 唯一对外接口
  runStartup(gateway: OutputGateway): Promise<void>;
  shutdown(): Promise<void>;
}

// 不再暴露：
// ❌ orchestrator: ConversationOrchestrator  → 拆分到各 Service
// ❌ pluginService: PluginService            → api.listSkills 等
// ❌ approvalHandler: ApprovalCallbackHandler → api.handleApprovalCallback
// ❌ roleResolver: RoleResolver              → api.resolveRole
// ❌ auditService: AuditService              → Guard 层内部使用
// ❌ projectSetupService: ProjectSetupService → api.createProject 等
// ❌ findProjectByChatId()                   → api.resolveProjectId
// ❌ persistence: PersistenceLayer           → L2 内部
// ❌ db: DatabaseSync                        → L2 内部
```

---

## 9. 现状 → 目标 差异表

| 问题 | 现状 | 目标 |
|------|------|------|
| God Object | `orchestrator.ts` 1517 行、80+ 方法 | 拆分到 10 个 Service |
| chatId 穿透 | 方法签名 + AgentApiPool + ProcessManager 全用 `chatId` | 全部改为 `projectId`（L2+L3 同步） |
| L1 业务逻辑 | `platform-commands.ts` 直接 `adminStateStore.write()` | 收回 ProjectService |
| 多入口 | `OrchestratorLayer` 暴露 6 个 service | 只暴露 `api: OrchestratorApi` |
| 无鉴权层 | L1 自行判断权限 | ApiGuard Proxy 统一拦截 |
| persistence 暴露 | `OrchestratorLayer.persistence` / `.db` | L2 内部 DI，不暴露 |
| 方法名不一致 | `handleThreadJoin` / `handleUserTextForUser` | `joinThread` / `createTurn` |
| 重复 API | `handleThreadListEntries` ≡ `listThreads`, `listBackends` ≡ `listAvailableBackends` | 合并，只保留一个 |
| L3→L2 跨层 import | `git-utils/merge.ts` import `services/contracts` | 类型下沉到 L3，L2 re-export |
| transport 泄漏 | `agent-core/index.ts` 直接导出 Factory 类 | 仅通过 `createDefaultTransportFactories()` |
| `HandleIntentResult` 耦合 | `handleMerge` 等返回 intent 层类型 | 定义 L2 原生 `MergeResult`（6-variant），移入 contracts |
| `index.ts` 导出过多 | 直接导出 8 个应删除的符号 | 见下方导出清理表 |

### 9.1 `index.ts` 导出清理明细

| 当前导出 | 行号 | 目标 |
|---------|------|------|
| `ConversationOrchestrator` (class) | 26 | **删除**（拆分后不存在） |
| `PluginService` (class) | 30 | **删除**（通过 API 访问） |
| `ProjectSetupService` (class) | 33 | **删除**（收入 ProjectService） |
| `classifyIntent`, `dispatchIntent` | 54 | **删除**（intent 上移 L1） |
| `PlatformActionRouter`, `PlatformInputRouter` | 57-58 | **删除**（intent 上移 L1） |
| `platform-commands.*` | 56 | **删除**（收回 L2） |
| `isBackendId`, `transportFor`, `BackendId` (L3) | 62-63 | **改为从 contracts re-export** |
| `MergeDiffStats` (L3) | 66 | **改为从 contracts re-export** |
| `UnifiedAgentEvent` (L3) | 49 | **改为从 contracts re-export** |
| `RouteBinding` (内部类型) | 50 | **删除**（event/ 内部） |

**目标 `index.ts` 应只导出**：
```typescript
export { createOrchestratorLayer, type OrchestratorLayer } from "./factory";
export { OrchestratorError, ErrorCode } from "./errors";
export type { OrchestratorApi } from "./api/orchestrator-api";
// contracts re-export 类型（含新增）
export type { MergeResult, IMError, IMMergeEvent } from "../contracts";
```

---

## 10. 目标文件结构

```
services/orchestrator/src/
├── api/
│   ├── orchestrator-api.ts          [NEW] OrchestratorApi 接口实现（Facade）
│   └── api-guard.ts                 [NEW] withApiGuards() + Permission + API_GUARDS
├── services/
│   ├── project-service.ts           [NEW] §0 — 吸收 ProjectSetupService + orchestrator 项目方法
│   ├── thread-service.ts            [REFACTOR] §1 — 吸收 orchestrator 线程方法
│   ├── turn-lifecycle-service.ts    [NEW] §2 — 从 orchestrator 提取 turn 主流程
│   ├── turn-data-service.ts         [RENAME] §3 — 现有 TurnQueryService + TurnCommandService 合并
│   ├── snapshot-service.ts          [REFACTOR] §4 — 吸收 orchestrator 快照方法
│   ├── merge-service.ts             [RENAME] §5 — 现有 MergeUseCase
│   ├── backend-service.ts           [REFACTOR] §6 — 现有 BackendAdminService 扩展
│   ├── iam-service.ts               [NEW] §7 — 吸收 RoleResolver + UserRepository 操作
│   ├── skill-service.ts             [RENAME] §8 — 现有 PluginService
│   └── approval-service.ts          [RENAME] §9 — 现有 ApprovalUseCase
├── session/                          [保留] AgentApiPool, FactoryRegistry, StateMachine
├── event/                            [保留] EventPipeline, Router, Transformer
├── backend/                          [保留] BackendConfigService, SessionResolver, Registry
├── thread-state/                     [保留] ThreadRegistry 接口 + UserThreadBinding 接口
├── turn-state/                       [保留] TurnRepository + TurnDetailRepository 接口
├── merge-state/                      [保留] MergeSessionRepository 接口
├── iam/                              [保留] permissions.ts 常量
├── factory.ts                        [REFACTOR] 只返回 { api, runStartup, shutdown }
├── index.ts                          [REFACTOR] 导出 OrchestratorLayer + 类型
└── orchestrator.ts                   [DELETE] 拆分完成后移除
```
