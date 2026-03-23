# L3 Internal Architecture（目标状态）

> [!CAUTION]
> 本文档描述 L3 各包的**内部结构和目标架构**。L3 是最底层，禁止 import L2/L1/L0。

---

## 1. 包概览

```
packages/
├── agent-core/     后端协议统一层（codex stdio / ACP SSE）
├── git-utils/      Git 操作工具库（worktree / merge / snapshot / commit）
├── logger/         跨切面日志基础设施
└── admin-ui/       管理面板前端（独立部署，不参与服务端架构）
```

| 包 | 文件数 | 代码量 | 职责 |
|----|--------|--------|------|
| `agent-core` | ~19 | ~35KB | 统一后端协议、会话管理、事件桥接 |
| `git-utils` | 10 | ~25KB | Git 操作（worktree 隔离、merge 冲突解决、快照） |
| `logger` | ~3 | ~2KB | 日志工厂 + 文件 sink |
| `admin-ui` | — | — | 前端，不参与本文档 |

---

## 2. agent-core

### 2.1 模块结构

```
agent-core/src/
├── index.ts                    公开 API（所有 L2 导入的唯一入口）
├── types.ts                    核心接口：AgentApi, AgentApiPool, AgentApiFactory, RuntimeConfig
├── backend-identity.ts         BackendIdentity 值对象 + transportFor()
├── backend-config-types.ts     后端配置类型：UnifiedProviderInput, StoredProfile
├── unified-agent-event.ts      统一事件模型：13 种事件类型
├── rpc-types.ts                JSON-RPC 原语：RpcTransport, JsonRpcRequest/Response
├── rpc-client.ts               JsonRpcClient（initialize → call → notify）
├── stdio-transport.ts          StdioRpcTransport（stdin/stdout JSON-RPC）
├── agent-process-manager.ts    进程生命周期管理
├── constants.ts                [DELETE] MAIN_THREAD_NAME 上移 L2，SYSTEM_USER_ID 删除
└── transports/
    ├── codex/                  Codex stdio 协议实现
    │   ├── codex-api-factory.ts   AgentApiFactory 实现
    │   ├── codex-client.ts        Codex 特定 RPC 封装
    │   ├── codex-event-bridge.ts  Codex 事件 → UnifiedAgentEvent 转换（22KB）
    │   ├── approval.ts            审批请求处理
    │   ├── event-stream.ts        事件流解析
    │   └── generated/             协议类型定义
    └── acp/                    ACP SSE 协议实现
        ├── acp-api-factory.ts     AgentApiFactory 实现
        ├── acp-client.ts          SSE HTTP 客户端
        ├── acp-event-bridge.ts    ACP 事件 → UnifiedAgentEvent 转换
        ├── acp-api-adapter.ts     AgentApi 适配器
        └── acp-process-manager.ts 进程管理适配
```

### 2.2 核心接口

```typescript
// L2 通过这些接口与 agent-core 交互，无需知道 codex/acp 差异

interface AgentApi {                      // 单个后端会话
  threadStart(params): Promise<{ thread: { id } }>
  turnStart(params): Promise<{ turn: { id } }>
  turnInterrupt?(threadId, turnId): Promise<void>
  threadResume?(threadId, config): Promise<{ thread: { id } }>  // 会话丢失后恢复
  respondApproval?(params): Promise<void>
  respondUserInput?(params): Promise<void>  // 回答 agent 的用户输入请求
  setMode?(mode: "plan" | "code"): Promise<void>  // 切换 agent 模式
  onNotification?(handler): void          // → UnifiedAgentEvent
}

interface AgentApiFactory {               // 创建 AgentApi 的工厂
  create(config): Promise<AgentApi>
  dispose?(api): Promise<void>
}

interface AgentApiPool {                  // 会话池（L2 session/ 实现）
  createWithConfig(projectId, threadName, config): Promise<AgentApi>
  get(projectId, threadName): AgentApi | null
  releaseThread(projectId, threadName): Promise<void>
}
```

### 2.3 L2 唯一入口

```typescript
// L2 的 factory.ts 只调用这一个函数
import { createDefaultTransportFactories } from "packages/agent-core";

const factories = createDefaultTransportFactories();
// → { codex: CodexProtocolApiFactory, acp: AcpApiFactory }
```

### 2.4 公开 API 完整导出表（`index.ts`）

> 以下是 `agent-core/src/index.ts` 导出的全部符号。L2 **只能**通过此入口 import。

| 分类 | 导出符号 | 类型 |
|------|---------|------|
| **BackendIdentity** | `BackendId`, `TransportType`, `BackendIdentity` | type |
| | `transportFor()`, `isBackendId()`, `createBackendIdentity()` | function |
| **BackendConfig** | `UnifiedProviderInput`, `UnifiedProfileInput`, `StoredProvider`, `StoredProfile`, `BackendConfigData`, `BackendCmdResult`, `CodexServerCmdResult` | type |
| **核心接口** | `RuntimeConfig`, `AgentApi`, `ApprovalAwareAgentApi`, `AgentApiPool`, `AgentApiFactory`, `RuntimeConfigProvider` | type |
| **统一事件** | `UnifiedAgentEvent`, `UnifiedAgentTool` | type |
| **RPC** | `JsonRpcRequest`, `JsonRpcNotification`, `JsonRpcResponse`, `RpcTransport`, `RpcNotification` | type |
| | `JsonRpcClient`, `RpcApiError`, `RpcClientStateError` | class |
| | `InitializeParams` | type |
| **Transport** | `StdioRpcTransport`, `spawnStdioRpcTransport()` | class/function |
| **进程管理** | `AgentProcessManager` | class |
| | `ManagedProcess`, `ProcessSpawnConfig` | type |
| **工厂入口** | `createDefaultTransportFactories()` | function |
| **[待删除]** | ~~`CodexProtocolApiFactory`~~, ~~`AcpApiFactory`~~ | class |
| **[待删除]** | ~~`MAIN_THREAD_NAME`~~, ~~`SYSTEM_USER_ID`~~ | const |
| **[待删除]** | ~~`EventMsg`~~ (codex 内部类型泄漏) | type |

> [!WARNING]
> 标记 ~~删除线~~ 的导出在目标架构中应移除：
> - `CodexProtocolApiFactory` / `AcpApiFactory` → 仅通过 `createDefaultTransportFactories()` 暴露
> - `MAIN_THREAD_NAME` / `SYSTEM_USER_ID` → 上移 L2 / 删除
> - `EventMsg` → Codex 内部类型不应暴露给 L2

### 2.5 事件流

```
Backend Process (codex stdio / acp SSE)
  → codex-event-bridge / acp-event-bridge     [transport 内部]
  → UnifiedAgentEvent                         [统一模型]
  → AgentApi.onNotification(handler)          [L2 订阅]
  → EventPipeline (L2)                        [进入 L2]
```

**UnifiedAgentEvent 完整类型表**（13 种）：

| 事件类型 | 关键字段 | 来源 | L2 处理方 |
|---------|---------|------|----------|
| `content_delta` | `delta: string` | codex/acp | EventPipeline → Router |
| `reasoning_delta` | `delta: string` | codex/acp | EventPipeline → Router |
| `plan_delta` | `delta: string` | codex | EventPipeline → Router |
| `plan_update` | `plan: Array<{ step, status }>` | codex | EventPipeline → Router |
| `tool_output` | `callId, delta, source: "stdout"\|"stdin"` | codex/acp | EventPipeline → Router |
| `tool_begin` / `tool_end` | `tool: UnifiedAgentTool, label, status?` | codex/acp | EventPipeline → Router |
| `approval_request` | `approvalId, callId, approvalType, description` | codex/acp | EventPipeline → ApprovalService |
| `user_input` | `callId, questions: Array<{ text, options? }>` | acp | EventPipeline → Router |
| `turn_started` | `turnId?, title?` | codex/acp | EventPipeline（状态机 IDLE→RUNNING） |
| `turn_complete` | `turnId?, lastAgentMessage?` | codex/acp | EventPipeline → TurnLifecycleService |
| `turn_aborted` | `turnId?, title?` | codex/acp | EventPipeline（状态机→INTERRUPTED） |
| `token_usage` | `input, output, total?` | codex/acp | EventPipeline → TurnDataService |
| `notification` | `category, title, detail?` | codex/acp | EventPipeline → Router（L2 按 category 分流为 `error` 或 `notification`） |

`UnifiedAgentTool` 枚举：`exec_command` | `mcp_tool` | `web_search` | `image_gen` | `patch_apply` | `collab_agent`

### 2.6 目标状态（与现状差异）

| 组件 | 目标状态 |
|------|---------|
| `constants.ts` | **删除**。`MAIN_THREAD_NAME` 移至 L2（`services/contracts`）；`SYSTEM_USER_ID` 删除（未使用） |
| `AgentProcessManager` | key 从 `chatId` 改为 `projectId:threadName` 组合 |
| `AgentApiPool` 接口 | `createWithConfig(projectId, threadName, config)` — 参数从 `chatId` 改为 `projectId` |
| codex/acp factory | `threadName` 为必传参数，不做 `?? MAIN_THREAD_NAME` fallback |
| `index.ts` 导出 | 移除 `CodexProtocolApiFactory` / `AcpApiFactory` 直接导出，仅保留 `createDefaultTransportFactories()` |

---

## 3. git-utils

### 3.1 模块结构

```
git-utils/src/
├── index.ts            公开 API（所有 L2 导入的唯一入口）
├── git-exec.ts         底层 git 命令执行器
├── worktree.ts         线程隔离：createWorktree / removeWorktree / listWorktrees
├── merge.ts            合并操作：dryRunMerge / mergeWorktree / PR-style merge session
├── snapshot.ts         快照管理：createSnapshot / restoreSnapshot / diffSnapshot
├── commit.ts           提交操作：commitAndDiffWorktreeChanges / isWorktreeDirty
├── repo.ts             仓库操作：initRepo / ensureWorkBranch / pushBranch
├── diff-parser.ts      Diff 解析：parseDiffFileNames / parseDiffStats
├── merge-log-schema.ts Merge 日志 schema
└── default-excludes.ts 默认排除规则
```

### 3.2 功能分组

| 模块 | 纯函数 | 被 L2 哪个 Service 使用 |
|------|--------|----------------------|
| `worktree` | ✅ createWorktree, removeWorktree, getWorktreePath, getHeadSha, fastForwardWorktree | ThreadService |
| `merge` | ✅ dryRunMerge, mergeWorktree, startMergeSession, applyFileDecision, commitMergeSession, fastForwardMain | MergeService |
| `snapshot` | ✅ createSnapshot, restoreSnapshot, diffSnapshot, pinSnapshot | SnapshotService, TurnLifecycleService |
| `commit` | ✅ commitAndDiffWorktreeChanges, isWorktreeDirty | TurnLifecycleService |
| `repo` | ✅ initRepo, ensureWorkBranch, pushBranch, detectDefaultBranch | ProjectService |
| `diff-parser` | ✅ parseDiffFileNames, parseDiffStats | TurnDataService |

### 3.3 公开 API 完整导出表（`index.ts`）

> 以下是 `git-utils/src/index.ts` 导出的全部符号。L2 **只能**通过此入口 import。

| 分类 | 导出符号 | 类型 |
|------|---------|------|
| **worktree** | `createWorktree()`, `removeWorktree()`, `listWorktrees()`, `getWorktreePath()`, `assertWorktreeValid()`, `getHeadSha()`, `fastForwardWorktree()` | function |
| | `ensurePluginSymlink()` | function |
| **merge** | `dryRunMerge()`, `mergeWorktree()`, `startConflictMerge()`, `checkConflictsResolved()`, `unquoteGitPath()` | function |
| | `startMergeSession()`, `applyFileDecision()`, `commitMergeSession()`, `abortMergeSession()` | function |
| | `fastForwardMain()`, `commitWorktreeChanges()`, `readCachedFileDiff()`, `readWorktreeStatusMap()` | function |
| | `MergeDiffStats`, `DryRunMergeResult`, `MergeFileInfo`, `MergeSessionResult` | type |
| | `MergeLogContext` | type (from `merge-log-schema`) |
| **snapshot** | `createSnapshot()`, `restoreSnapshot()`, `diffSnapshot()`, `pinSnapshot()` | function |
| | `DiffFile`, `SnapshotDiff` | type |
| **commit** | `commitAndDiffWorktreeChanges()`, `isWorktreeDirty()` | function |
| | `TurnDiffResult` | type |
| **repo** | `initRepo()`, `getRemoteUrl()`, `setRemoteUrl()`, `shallowClone()`, `detectDefaultBranch()`, `getCurrentBranch()`, `ensureWorkBranch()`, `pushBranch()` | function |
| **diff-parser** | `parseDiffFileNames()`, `parseDiffStats()` | function |

> [!NOTE]
> `git-exec.ts`（底层 `git()` 函数）**不通过 `index.ts` 导出**。
> 当前 `thread-runtime-service.ts` 直接 import `git-exec` 属于违规，应改为使用 `worktree` 模块的公开 API。

### 3.4 目标状态（与现状差异）

| 组件 | 目标状态 |
|------|---------|
| `merge.ts` | 不再 import `services/contracts`。`MergeFileStatus`、`MergeFileDecision` 定义在 `merge.ts` 本地，L2 contracts re-export |
| `getWorktreePath` | 保持 `mainCwd--threadName` 命名约定，文档化 |

> [!WARNING]
> `merge.ts` 中 `import type { MergeFileStatus, MergeFileDecision } from "../../../services/contracts/im/im-output"`
> 违反 L3 禁止 import L2 的隔离规则。**修复方案**：将 `MergeFileStatus` 和 `MergeFileDecision`
> 类型定义移入 `git-utils/src/merge.ts` 本地，L2 contracts 改为从 `git-utils` re-export。

---

## 4. logger

### 4.1 结构

```
logger/src/
├── index.ts          re-export 入口
├── logger.ts         createLogger() 工厂 + Logger 接口
└── log-file-sink.ts  文件日志 sink + 多路 sink + 过滤 sink
```

### 4.2 特点

- **跨切面基础设施**：所有层（L0–L3）都可 import
- **零依赖**：不依赖任何其他包
- **结构化日志**：`createLogger(name)` → `log.info({ key: value }, "message")`
- **无需改造**

---

## 5. L3 目标架构调整汇总

| 改造项 | 包 | 变更 |
|--------|---|------|
| `chatId` → `projectId` | agent-core | `AgentProcessManager.start(projectKey, ...)`, `AgentApiPool` 接口参数 |
| 类型下沉 | git-utils | `MergeFileStatus`, `MergeFileDecision` 定义在 `merge.ts`，删除 L2 import |
| 限制导出 | agent-core | `index.ts` 移除直接导出 `CodexProtocolApiFactory` / `AcpApiFactory`，仅保留 `createDefaultTransportFactories()` |

---

## 6. L3 对 L2 的影响

L3 的问题直接影响 L2 internals 设计：

| L3 问题 | 对 L2 的影响 |
|---------|-------------|
| `AgentApiPool` 用 `chatId` | L2 `DefaultAgentApiPool` 和所有调用点必须改为 `projectId` |
| transport 直接导出 | L2 `factory.ts` 已正确使用 `createDefaultTransportFactories()`，但 `FactoryRegistry` 需清理直接 import |
| `MergeFileStatus` 跨层 | L2 `MergeUseCase` 当前从 contracts 获取此类型，修复后改为从 `git-utils` re-export |
