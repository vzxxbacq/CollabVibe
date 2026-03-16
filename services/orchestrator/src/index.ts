// ── Top-level ──
export { ConversationOrchestrator } from "./orchestrator";
export type { CreateThreadOptions, CreateThreadResult } from "./orchestrator";
export { OrchestratorError, ErrorCode } from "./errors";
export type { ErrorCodeValue } from "./errors";

// ── Use Cases ──
export { MergeUseCase } from "./use-cases/merge";
export { ApprovalUseCase } from "./use-cases/approval";

// ── Session ──
export { DefaultAgentApiPool } from "./session/agent-api-pool";
export { AgentApiFactoryRegistry } from "./session/factory-registry";
export { ApprovalWaitManager, ConversationStateMachine } from "./session/state-machine";

// ── Backend ──
export { DefaultRuntimeConfigProvider } from "./backend/runtime-config-provider";
export { BackendRegistry, createBackendRegistry } from "./backend/registry";
export { DefaultBackendSessionResolver } from "./backend/session-resolver";
export type { BackendSessionResolver, ResolvedBackendSession, AvailableBackend } from "./backend/session-resolver";
export { BackendConfigService } from "./backend/config-service";
export { BackendAdminService } from "./backend-admin-service";
export type { ProjectResolver, ProjectContextRecord } from "./project-resolver";

// ── Thread State ──
export { UserThreadBindingService } from "./thread-state/user-thread-binding-service";
export { ThreadService } from "./thread-state/thread-service";
export { ThreadRuntimeService } from "./thread-runtime-service";
export { InMemoryThreadTurnStateRepository } from "./thread-state/thread-turn-state-repository";
export type { ThreadTurnState } from "./thread-state/thread-turn-state";
export type { ThreadTurnStateRepository } from "./thread-state/thread-turn-state-repository";
export { InMemoryTurnRepository } from "./turn-state/turn-repository";
export type { TurnRecord, TurnStatus, TurnTokenUsage } from "./turn-state/turn-record";
export type { TurnRepository } from "./turn-state/turn-repository";
export { InMemoryTurnDetailRepository } from "./turn-state/turn-detail-repository";
export type { TurnDetailRecord, TurnPlanState, TurnToolCall, TurnToolOutput, TurnMode } from "./turn-state/turn-detail-record";
export type { TurnDetailRepository } from "./turn-state/turn-detail-repository";
export { TurnQueryService } from "./turn-query-service";
export { TurnCommandService } from "./turn-command-service";
export { SnapshotService } from "./snapshot-service";
export type { TurnListItem, TurnDetailAggregate, RecordTurnStartInput, TurnSummaryPatch, TurnMetadataPatch } from "./turn-types";


// ── Event ──
export { EventPipeline } from "./event/pipeline";
export type { RouteBinding } from "./event/pipeline";
export { AgentEventRouter } from "./event/router";

// ── Intent ──

export { handleInboundWebhook } from "./intent/webhook";

// ── External packages (re-exports for convenience) ──
export { AgentProcessManager } from "../../../packages/agent-core/src/agent-process-manager";
export { CodexProtocolApiFactory } from "../../../packages/codex-client/src/codex-api-factory";
export type { AgentApiFactory } from "../../../packages/agent-core/src/types";
export { AcpApiFactory } from "../../../packages/acp-client/src/acp-api-factory";
export type { UnifiedAgentEvent } from "../../../packages/agent-core/src/unified-agent-event";
export { codexNotificationToUnifiedEvent } from "../../../packages/codex-client/src/codex-event-bridge";
export { PluginService } from "../../../services/plugin/src/plugin-service";
export { defaultPluginDirForBackend } from "../../../services/plugin/src/plugin-paths";

// ── Contracts (types) ──
export * from "./contracts";
