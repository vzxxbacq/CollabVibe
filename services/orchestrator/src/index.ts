/**
 * @module services/orchestrator/src/index
 *
 * Public API of the orchestrator layer.
 *
 * ## External consumers should use:
 * - `createOrchestratorLayer()` — factory for all orchestrator services
 * - Error types for handler error handling
 * - Type-only imports for OrchestratorLike Pick types
 *
 * ## Internal classes (AgentApiPool, EventPipeline, etc.) are NOT exported.
 * They are consumed only by the factory.
 */

// ── Factory (primary entry point) ──
export { createOrchestratorLayer, type OrchestratorLayer, type OrchestratorLayerDeps } from "./factory";

// ── Error types (used by handlers for error handling) ──
export { OrchestratorError, ErrorCode } from "./errors";
export type { ErrorCodeValue } from "./errors";

// ── Types for handler Pick interfaces ──
// ConversationOrchestrator is exported type-only so `handlers/types.ts`
// can define `OrchestratorLike = Pick<ConversationOrchestrator, ...>`.
// External code should NOT instantiate it directly — use the factory.
export { ConversationOrchestrator } from "./orchestrator";
export type { CreateThreadOptions, CreateThreadResult } from "./orchestrator";

// ── Plugin service (used by handlers/types.ts for PluginServiceLike) ──
export { PluginService } from "./plugin/plugin-service";

// ── Project setup (moved from src/services → orchestrator layer) ──
export { ProjectSetupService } from "./project/project-service";

// ── Intent result types (used by message handlers for result dispatch) ──
export { ResultMode } from "./intent/result";
export type { HandleIntentResult } from "./intent/result";

// ── Contracts (shared type definitions) ──
export * from "./contracts";

// ── Types needed for OrchestratorLike / external type consumers ──
export type { TurnRecord, TurnStatus, TurnTokenUsage } from "./turn/turn-record";
export type { TurnDetailRecord, TurnPlanState, TurnToolCall, TurnToolOutput, TurnMode } from "./turn/turn-detail-record";
export type { TurnListItem, TurnDetailAggregate, RecordTurnStartInput, TurnSummaryPatch, TurnMetadataPatch } from "./turn/turn-types";
export type { ThreadTurnState } from "./thread/thread-turn-state";
export type { ProjectResolver } from "./project/project-resolver";
export type { BackendSessionResolver, ResolvedBackendSession, AvailableBackend } from "./backend/session-resolver";
export type { UnifiedAgentEvent } from "../../../packages/agent-core/src/unified-agent-event";
export type { RouteBinding } from "./event/pipeline";


// ── Dispatch (merged from services/dispatch/) ──
export { classifyIntent, dispatchIntent } from "./intent/dispatcher";
export type { IntentDispatchResult, IntentParams } from "./intent/dispatcher";
export * from "./commands/platform-commands";
export { PlatformActionRouter } from "./commands/platform-action-router";
export { PlatformInputRouter } from "./commands/platform-input-router";
export type { CoreDeps } from "./handler-types";

// ── Backend identity (re-export from agent-core so L1 doesn't import L3) ──
export { isBackendId, transportFor } from "../../../packages/agent-core/src/backend-identity";
export type { BackendId } from "../../../packages/agent-core/src/backend-identity";

// ── Merge types (re-export so L1 doesn't import L3 git-utils) ──
export type { MergeDiffStats } from "../../../packages/git-utils/src/merge";
