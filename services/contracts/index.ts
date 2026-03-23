/**
 * @module services/contracts
 *
 * L2 公开类型层 — L1 的唯一 import 入口。
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ 本文件的导出列表 100% 对应 docs/01-architecture/core-api.md。     │
 * │ 禁止使用 export *。每一条 export 必须可追溯到 core-api.md 中的   │
 * │ 具体 API 签名、数据类型或输出契约。                               │
 * │                                                                  │
 * │ L1 只允许从此文件 import，不允许深入任何子目录。                   │
 * │ 增删任何导出项必须同步更新 core-api.md 并经过审批。               │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * @see docs/01-architecture/core-api.md
 */

// ── §API Entry (core-api.md §API 入口) ──────────────────────────────────────

export type {
  OrchestratorApi,
  OrchestratorLayer,
  OutputGateway,
} from "./src/orchestrator-api";

export { AuthorizationError } from "./src/orchestrator-api";

// ── §0-§9 API Shared Types (core-api.md 各 section 引用的输入/输出类型) ──────

export type {
  TurnInputItem,
  MergeContext,
  MergeResult,
  MergeDiffStats,
  IMError,
  IMMergeEvent,
} from "./src/orchestrator-api";

// ── §0 Project (core-api.md §0 项目与绑定) ──────────────────────────────────

export type { ProjectRecord } from "./admin/admin-state";

// ── §1 Thread (core-api.md §1 Thread 管理) ──────────────────────────────────

export type { ThreadRecord } from "./src/types/thread";

// ── §2-§3 Turn (core-api.md §2-§3 Turn 生命周期 + 数据查询) ─────────────────

export type {
  TurnRecord,
  TurnStatus,
  TurnTokenUsage,
  TurnDetailRecord,
  TurnMode,
  TurnPlanState,
  TurnToolCall,
  TurnToolOutput,
} from "./src/types/turn";

export type { TurnCardData } from "./im/turn-card-data-provider";

// ── §4 Snapshot (core-api.md §4 Snapshot 管理) ──────────────────────────────

export type { TurnSnapshotRecord } from "./src/types/snapshot";

// ── §7 IAM (core-api.md §7 IAM 与用户管理) ─────────────────────────────────

export type { ProjectRole, EffectiveRole } from "./src/types/iam";

// ── §Output PlatformOutput (core-api.md §Output 输出契约) ───────────────────

export type {
  PlatformOutput,
  ContentOutput,
  ReasoningOutput,
  PlanOutput,
  PlanUpdateOutput,
  ToolOutputDelta,
  ProgressOutput,
  NotificationOutput,
  ApprovalRequestOutput,
  UserInputRequestOutput,
  TurnSummaryOutput,
  ThreadOperationOutput,
  SnapshotOperationOutput,
  ConfigOperationOutput,
  SkillOperationOutput,
  MergeOperationOutput,
  MergeReviewOutput,
  MergeSummaryOutput,
  MergeTimeoutOutput,
  ThreadNewFormOutput,
  HelpPanelOutput,
  TurnDetailOutput,
  AdminPanelOutput,
} from "./im/platform-output";

// ── §Output IM Data Types (PlatformOutput.data 载荷类型) ────────────────────

export type {
  IMContentChunk,
  IMReasoningChunk,
  IMPlanChunk,
  IMPlanUpdate,
  IMToolOutputChunk,
  IMProgressEvent,
  IMApprovalRequest,
  IMUserInputRequest,
  IMNotification,
  IMTurnSummary,
  IMThreadOperation,
  IMThreadNewFormData,
  IMConfigOperation,
  IMSnapshotOperation,
  IMSkillOperation,
  IMThreadMergeOperation,
  IMFileMergeReview,
  IMMergeSummary,
  MergeFileStatus,
  MergeFileDecision,
} from "./im/im-output";

// NOTE: TurnStateSnapshot 和 IMOutputMessage 是 L2 Path B 内部类型，不暴露给 L1。
// TurnStateSnapshot 仅用于 syncTurnState/finalizeTurnState（L2 内部）。
// IMOutputMessage 仅用于 appendTurnEvent（L2 内部）。

// ── Bootstrap (core-api.md §CoreDeps) ───────────────────────────────────────

export type { OrchestratorConfig } from "./admin/admin-state";
export type { AppConfig } from "./admin/contracts";
export type { AppLocale } from "./im/app-locale";

// ── L3 Re-export (L1 禁止直接 import packages/agent-core) ──────────────────

export type {
  BackendIdentity,
  BackendId,
} from "../../packages/agent-core/src/backend-identity";

export { MAIN_THREAD_NAME } from "../../packages/agent-core/src/constants";
