// Centralized type re-exports for external consumers
export type { RuntimeConfig, RuntimeConfigProvider, AgentApi, AgentApiPool } from "../../../packages/agent-core/src/types";
export type { AgentApiFactory as AgentApiFactoryPort } from "../../../packages/agent-core/src/types";
export type { ManagedProcess } from "../../../packages/agent-core/src/agent-process-manager";
export type { RuntimeDefaults } from "./backend/runtime-defaults";
export { ResultMode } from "./intent/result";
export type { HandleIntentResult, MergeDiffStats, ResultModeValue } from "./intent/result";
export type { UserThreadBinding, UserThreadBindingRepository } from "./thread/user-thread-binding-types";
export type { ThreadRecord, ThreadRegistry } from "./thread/thread-registry";
export type { ThreadTurnState } from "./thread/thread-turn-state";
export type { ThreadTurnStateRepository } from "./thread/thread-turn-state-repository";
export { ThreadService } from "./thread/thread-service";
export type { SnapshotRepository, TurnSnapshotRecord } from "./snapshot/snapshot-types";
export type { TurnRecord, TurnStatus, TurnTokenUsage } from "./turn/turn-record";
export type { TurnRepository } from "./turn/turn-repository";
export type { TurnDetailRecord, TurnPlanState, TurnToolCall, TurnToolOutput, TurnMode } from "./turn/turn-detail-record";
export type { TurnDetailRepository } from "./turn/turn-detail-repository";
export type { TurnListItem, TurnDetailAggregate, RecordTurnStartInput, TurnSummaryPatch, TurnMetadataPatch } from "./turn/turn-types";
export type { InboundWebhookParams, InboundWebhookResult } from "./intent/webhook";
export type { ConversationState, ApprovalWaitConfig } from "./session/state-machine";
export type { BackendDefinition } from "./backend/registry";
export type { PluginDefinition } from "./plugin/plugin-service";
export type {
  MergeSessionRepository,
  PersistedMergeSessionFile,
  PersistedMergeSessionRecord,
} from "./merge/merge-session-repository";
