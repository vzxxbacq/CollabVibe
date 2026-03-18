import type { AgentApi, AgentApiPool, RuntimeConfigProvider } from "../../../packages/agent-core/src/types";
import type { MergeDiffStats } from "../../../packages/git-utils/src/merge";
import type { IMOutputMessage } from "../../contracts/im/im-output";
import type { SnapshotRepository } from "./thread-state/snapshot-types";
import type { ThreadRecord } from "./thread-state/thread-registry";
import type { MergeSessionRepository } from "./merge-state/merge-session-repository";
import { ApprovalWaitManager, ConversationStateMachine } from "./session/state-machine";
import type { TurnStateManager } from "./session/turn-state-manager";
import { createLogger } from "../../../packages/logger/src/index";
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
  readonly mergeSessionRepository?: MergeSessionRepository;
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
  registerApprovalRequest(params: {
    chatId: string;
    userId?: string;
    approvalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
  }): void;
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
