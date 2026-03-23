/**
 * @module services/index
 *
 * L2 Orchestrator 唯一公开出口 — L1 的唯一 import 入口。
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ L1 只允许 `from "…/services/index"` 或 `from "…/services"`。      │
 * │ 禁止直接 import 子目录文件（audit/、iam/、persistence/ 等）。      │
 * │ 增删任何导出项必须同步更新 core-api.md 并经过审批。                │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * @see docs/01-architecture/core-api.md
 */

// ══════════════════════════════════════════════════════════════════════════
// § Factory + Error (L0/L1 Bootstrap)
// ══════════════════════════════════════════════════════════════════════════

export { createOrchestratorLayer } from "./factory";
export type { OrchestratorLayer } from "./orchestrator-api";
export type { OrchestratorLayerDeps } from "./factory";
export { OrchestratorError, ErrorCode } from "./errors";
export type { ErrorCodeValue } from "./errors";

// ══════════════════════════════════════════════════════════════════════════
// § API Entry (core-api.md §API 入口)
// ══════════════════════════════════════════════════════════════════════════

export type { OrchestratorApi } from "./orchestrator-api";
export { AuthorizationError } from "./orchestrator-api";

// ══════════════════════════════════════════════════════════════════════════
// § API Shared Types (core-api.md 各 section)
// ══════════════════════════════════════════════════════════════════════════

export type {
  OrchestratorTurnInputItem,
  MergeContext,
  MergeResult,
  MergeDiffStats,
  IMError,
  IMMergeEvent,
  ProjectRecord,
  ThreadRecord,
  TurnRecord,
  TurnStatus,
  TurnDetailRecord,
  TurnSnapshotRecord,
  TurnCardData,
  BackendIdentity,
  BackendId,
} from "./orchestrator-api";
export type { OrchestratorConfig } from "./project/orchestrator-config";
export type { AppConfig } from "./project/app-config";

// §2-§3 Turn
export type {
  TurnTokenUsage,
  TurnMode,
  TurnPlanState,
  TurnToolCall,
  TurnToolOutput,
} from "./turn/types";

// §7 IAM
export type { ProjectRole, EffectiveRole } from "./types/iam";
export type { Permission } from "./iam/permissions";
export { RolePermissionMap } from "./iam/permissions";
export { hasPermission, authorize } from "./iam/authorize";

// §8 Locale
export type { AppLocale } from "./types/app-locale";
export { APP_LOCALES, DEFAULT_APP_LOCALE } from "./types/app-locale";

// ══════════════════════════════════════════════════════════════════════════
// § Output (core-api.md §Output)
// ══════════════════════════════════════════════════════════════════════════

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
  ErrorOutput,
  MergeEventOutput,
  ThreadNewFormOutput,
  HelpPanelOutput,
  TurnDetailOutput,
  AdminPanelOutput,
  OutputGateway,
} from "./event/output-contracts";

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
  IMThreadCreatedResult,
  IMConfigOperation,
  IMSnapshotOperation,
  IMSkillOperation,
  IMThreadMergeOperation,
  IMFileMergeReview,
  IMMergeSummary,
  IMAdminProjectPanel,
  IMAdminUserPanel,
  IMAdminMemberPanel,
  IMAdminSkillPanel,
  IMAdminBackendPanel,
  MergeFileStatus,
  MergeFileDecision,
} from "./event/im-output";

export {
  isBackendId,
  transportFor,
} from "../packages/agent-core/src/index";
