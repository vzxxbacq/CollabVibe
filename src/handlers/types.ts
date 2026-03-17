/**
 * @module src/handlers/types
 * @layer Shared type definitions
 *
 * Defines `*Like` type aliases that decouple core/feishu layers from concrete implementations.
 *
 * ## Responsibilities
 * - Define `OrchestratorLike`, `AgentApiPoolLike`, `FeishuAdapterLike`, `FeishuOutputAdapterLike`, etc.
 * - Define `CardActionResponse` type used by card handlers
 * - Define `ServerHandlerDeps` (extends CoreDeps) — backward compatible alias for FeishuHandlerDeps
 *
 * ## Import Constraints
 * ✅ May import: packages/*, services/* (for concrete types to extract *Like from)
 * ❌ Must NOT import: src/core/, src/feishu/ (to avoid circular deps)
 *
 * ## Consumers
 * - `src/core/types.ts` — imports *Like aliases for CoreDeps fields
 * - `src/feishu/types.ts` — imports FeishuAdapterLike, FeishuOutputAdapterLike, ProjectSetupServiceLike
 * - `src/feishu/feishu-card-handler.ts` — imports CardActionResponse
 * - Test files in `src/__tests__/` — import ServerHandlerDeps for mock construction
 *
 * ## Migration Note
 * The *Like types are defined here as a central hub. In a future cleanup,
 * they could be moved to their respective packages (e.g. OrchestratorLike → services/orchestrator).
 */
import type { FeishuAdapter, FeishuOutputAdapter } from "../../packages/channel-feishu/src/index";
import type { ApprovalCallbackHandler } from "../../services/approval/src/index";
import type {
  ConversationOrchestrator,
  PluginService,
} from "../../services/orchestrator/src/index";
import type { AdminPersistedState, AdminStateStore } from "../../services/admin-api/src/contracts";
import type { AppConfig } from "../config";
import type { ProjectSetupService } from "../services/project-setup-service";

export type FeishuAdapterLike = Pick<
  FeishuAdapter,
  "sendMessage" | "sendInteractiveCard" | "updateInteractiveCard" | "getUserDisplayName" | "pinMessage" | "listChatMembers" | "leaveChat" | "downloadMessageFile"
>;

export type FeishuOutputAdapterLike =
  Pick<
    FeishuOutputAdapter,
    | "buildHelpCard"
    | "buildInitCard"
    | "buildInitBindMenuCard"
    | "buildInitCreateMenuCard"
    | "buildInitSuccessCard"
    | "buildProjectResumedCard"
    | "buildThreadCreatedCard"
    | "buildMergeResultCard"
    | "buildMergePreviewCard"
    | "buildThreadListCard"
    | "buildSnapshotHistoryCard"
    | "buildModelListCard"
    | "buildHelpThreadCard"
    | "buildHelpThreadNewCard"
    | "buildHelpMergeCard"
    | "buildHelpSkillCard"
    | "buildHelpBackendCard"
    | "buildAdminHelpCard"
    | "buildAdminProjectCard"
    | "buildAdminProjectEditCard"
    | "buildAdminUserCard"
    | "buildAdminMemberCard"
    | "buildAdminSkillCard"
    | "buildAdminBackendCard"
    | "buildAdminBackendEditCard"
    | "buildAdminBackendModelCard"
    | "buildAdminBackendPolicyCard"
    | "buildAdminBackendAddProviderCard"
    | "sendThreadNewForm"
    | "sendThreadOperation"
    | "sendSnapshotOperation"
    | "sendConfigOperation"
    | "sendSkillOperation"
    | "sendMergeOperation"
    | "sendFileReview"
    | "sendMergeSummary"
    | "sendAdminHelp"
    | "sendAdminProjectPanel"
    | "sendAdminMemberPanel"
    | "sendAdminSkillPanel"
    | "sendAdminBackendPanel"
    | "sendRawCard"
    | "updateCardAction"
    | "setCardThreadName"
    | "setCardBackendInfo"
    | "setCardTurnMode"
    | "setCardPromptSummary"
    | "renderFileChangesCard"
    | "renderToolProgressCard"
    | "primeHistoricalTurnCard"
    | "getTurnCardThreadName"
    | "buildTurnHistoryCard"
    | "buildFileReviewCard"
    | "buildMergeSummaryCard"
  >
  & Partial<Pick<FeishuOutputAdapter, "buildAdminSkillInstallCard" | "buildAdminSkillFileInstallCard" | "buildAdminSkillFileConfirmCard">>;

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
  | "bindTurnPipeline"
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
  | "mergeDecideFile"
  | "mergeAcceptAll"
  | "commitMergeReview"
  | "cancelMergeReview"
  // Phase 2: Agent conflict resolution
  | "resolveConflictsViaAgent"
  | "retryMergeFile"
  | "onMergeResolverDone"
  | "onMergeFileRetryDone"
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

import type { CoreDeps } from "../core/types";

/** @deprecated Use FeishuHandlerDeps from src/feishu/types.ts instead */
export type ServerHandlerDeps = CoreDeps & {
  feishuAdapter: FeishuAdapterLike;
  feishuOutputAdapter: FeishuOutputAdapterLike;
  recentMessageIds: Set<string>;
  messageDedupTtlMs: number;
  projectSetupService: ProjectSetupServiceLike;
};

export type CardActionResponse = { card: { type: "raw"; data: Record<string, unknown> } } | void;

export type AdminStateLike = AdminPersistedState;
