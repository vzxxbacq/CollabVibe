/**
 * @module src/handlers/types
 * @layer Shared type definitions
 *
 * Defines `*Like` type aliases that decouple core/feishu layers from concrete implementations.
 *
 * ## Responsibilities
 * - Define `OrchestratorLike`, `PluginServiceLike`, `ApprovalHandlerLike`, etc.
 * - Define `CardActionResponse` type used by card handlers
 *
 * ## Import Constraints
 * ✅ May import: packages/*, services/* (for concrete types to extract *Like from)
 * ❌ Must NOT import: src/core/, src/feishu/ (to avoid circular deps)
 *
 * ## Consumers
 * - `src/core/types.ts` — imports shared service aliases for CoreDeps fields
 * - `src/feishu/feishu-card-handler.ts` — imports CardActionResponse
 *
 * ## Migration Note
 * Shared service aliases stay here. Platform-specific ports belong to platform-local `src/feishu/types.ts`
 * and `src/slack/types.ts`.
 */
import type { ApprovalCallbackHandler } from "../../services/orchestrator/src/approval/index";
import type {
  ConversationOrchestrator,
  PluginService,
  ProjectSetupService,
} from "../../services/orchestrator/src/index";
import type { AdminPersistedState, AdminStateStore } from "../../services/contracts/admin/contracts";
import type { AppConfig } from "../config";

export type OrchestratorLike = Pick<
  ConversationOrchestrator,
  | "handleIntent"
  | "handleThreadList"
  | "handleThreadListEntries"
  | "createThread"
  | "handleThreadJoin"
  | "handleThreadLeave"
  | "handleTurnInterrupt"
  | "handleRollback"
  | "acceptTurn"
  | "revertTurn"
  | "handleMerge"
  | "handleMergeConfirm"
  | "handleMergePreview"
  | "listSnapshots"
  | "jumpToSnapshot"
  | "recordTurnStart"
  | "updateSnapshotSummary"
  | "updateTurnSummary"
  | "updateTurnMetadata"
  | "appendTurnEvent"
  | "getTurnDetail"
  | "listTurns"
  | "isPendingApproval"
  | "getConversationState"
  // Phase 2A facade methods
  | "getUserActiveThread"
  | "getThreadRecord"
  | "listBackends"
  | "listAvailableBackends"
  | "resolveBackend"
  | "resolveSession"
  // Admin backend management facade
  | "readBackendConfigs"
  | "adminAddProvider"
  | "adminRemoveProvider"
  | "adminAddModel"
  | "adminRemoveModel"
  | "adminTriggerRecheck"
  | "updateBackendPolicy"
  | "listModelsForBackend"
  | "adminWriteProfile"
  | "adminDeleteProfile"
  | "respondUserInput"
  // Per-file merge review facade
  | "startMergeReview"
  | "getMergeReview"
  | "mergeDecideFile"
  | "mergeAcceptAll"
  | "commitMergeReview"
  | "cancelMergeReview"
  // Phase 2: Agent conflict resolution
  | "configureMergeResolver"
  | "resolveConflictsViaAgent"
  | "retryMergeFile"
  // Project lifecycle
  | "onProjectDeactivated"
  | "recoverSessions"

>;

export type PluginServiceLike =
  Pick<PluginService, "getInstallablePlugins" | "install" | "remove" | "list" | "collectMcpServers">
  & Partial<Pick<PluginService, "bindToProject" | "unbindFromProject" | "listProjectPlugins" | "listProjectBindings" | "listCatalog" | "importFromGithubSubpath" | "installFromLocalSource" | "inspectLocalSource" | "validateSkillNameCandidate" | "syncProjectSkills" | "ensureProjectThreadSkills" | "allocateStagingDir" | "getCanonicalStorePath" | "getStagingStorePath">>;
export type ApprovalHandlerLike = Pick<ApprovalCallbackHandler, "handle">;
export type ProjectSetupServiceLike = Pick<ProjectSetupService, "setupFromInitCard" | "bindExistingProject" | "disableAndUnbindProjectById" | "disableAndUnbindProjectByChatId" | "updateGitRemote">;
export type AdminStateStoreLike = Pick<AdminStateStore, "read" | "write">;

import type { CoreDeps } from "../../services/orchestrator/src/handler-types";

export type CardActionResponse = { card: { type: "raw"; data: Record<string, unknown> } } | void;

export type AdminStateLike = AdminPersistedState;
