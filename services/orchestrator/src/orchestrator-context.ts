import type { AgentApi, AgentApiPool, RuntimeConfigProvider } from "../../../packages/agent-core/src/types";
import type { MergeDiffStats } from "../../../packages/git-utils/src/merge";
import type { IMOutputMessage } from "../../../packages/channel-core/src/im-output";
import type { RouteBinding } from "./event/pipeline";
import type { SnapshotRepository } from "./thread-state/snapshot-types";
import type { ThreadRecord } from "./thread-state/thread-registry";
import { ApprovalWaitManager, ConversationStateMachine } from "./session/state-machine";
import type { TurnStateManager } from "./session/turn-state-manager";
import { createLogger } from "../../../packages/channel-core/src/index";
import type { CreateThreadOptions, CreateThreadResult } from "./orchestrator";

export type ProjectThreadKey = string;

export interface TurnSnapshot {
  chatId: string;
  threadId: string;
  turnId: string;
  traceId?: string;
  snapshotSha: string;
  cwd: string;
}

/**
 * Shared context for orchestrator use-case modules.
 * Provides access to core services without creating circular deps.
 */
export interface OrchestratorContext {
  readonly log: ReturnType<typeof createLogger>;
  readonly agentApiPool: AgentApiPool;
  readonly runtimeConfigProvider: RuntimeConfigProvider;
  readonly snapshotRepo?: SnapshotRepository;
  readonly pluginDir?: string;
  readonly approvalTimeoutMs: number;

  // Encapsulated turn state (replaces 4 raw Maps)
  readonly turnState: TurnStateManager;

  // Session state (managed via getSessionStateMachine/getApprovalWaitManager)
  readonly sessionStateMachines: Map<ProjectThreadKey, ConversationStateMachine>;
  readonly sessionApprovalWaitManagers: Map<ProjectThreadKey, ApprovalWaitManager>;

  // Helper methods (resolved by facade)
  toProjectThreadKey(chatId: string, threadName: string): ProjectThreadKey;
  resolveProjectId(chatId: string): string;
  resolveThreadName(chatId: string, userId?: string): Promise<string | null>;
  resolveAgentApi(chatId: string, threadName: string): Promise<AgentApi>;
  getSessionStateMachine(projectThreadKey: ProjectThreadKey): ConversationStateMachine;
  getApprovalWaitManager(projectThreadKey: ProjectThreadKey): ApprovalWaitManager;
  ensureCanStartTurn(projectThreadKey: ProjectThreadKey, options?: { allowConcurrentRunning?: boolean }): void;
  finishSessionTurn(projectThreadKey: ProjectThreadKey): void;

  // Unified thread creation (Phase 1A)
  createThread(projectId: string, chatId: string, userId: string, threadName: string, options: CreateThreadOptions): Promise<CreateThreadResult>;
  getThreadRecord(projectId: string, threadName: string): ThreadRecord | null;
  markThreadMerged(projectId: string, threadName: string): void;

  // Path B: route an output message through AgentEventRouter
  routeMessage(chatId: string, message: IMOutputMessage): Promise<void>;

  // EventPipeline binding for merge conflict resolver turns
  bindTurnPipeline?(route: RouteBinding): boolean;
}

export interface PendingApprovalContext {
  projectThreadKey: ProjectThreadKey;
  chatId: string;
  userId?: string;
  threadId: string;
  threadName: string;
  turnId: string;
  callId: string;
  approvalType: "command_exec" | "file_change";
}

export interface PendingMerge {
  projectId: string;
  branchName: string;
  mergeBranch?: string;
  diffStats?: MergeDiffStats;
  preMergeSha?: string;
}
