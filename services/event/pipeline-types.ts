import type { TurnStateSnapshot } from "../turn/turn-state";
import type { TurnDiffResult } from "../../packages/git-utils/src/index";
import type { UnifiedAgentEvent } from "../../packages/agent-core/src/index";

type MaybePromise<T> = T | Promise<T>;

export interface NotificationSource {
  onNotification(handler: (event: UnifiedAgentEvent) => void): void;
}

export interface ThreadRouteBinding {
  projectId: string;
  userId?: string;
  traceId?: string;
  threadName: string;
  threadId: string;
  cwd?: string;
  turnMode?: "plan";
}

export interface RouteBinding extends ThreadRouteBinding {
  turnId: string;
}

/**
 * Callbacks that decouple the pipeline from the orchestrator.
 * Any module (orchestrator, test harness, etc.) can provide these.
 */
export interface PipelineCallbacks {
  registerApprovalRequest(params: {
    projectId: string;
    userId?: string;
    backendApprovalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
    display: {
      threadName: string;
      displayName?: string;
      summary?: string;
      reason?: string;
      cwd?: string;
      description: string;
      files?: string[];
      createdAt: string;
    };
  }): MaybePromise<{ accepted: boolean; approvalId?: string }>;
  finishTurn(projectId: string, threadId: string, options?: { threadName?: string }): Promise<TurnDiffResult | null>;
  ensureTurnStarted?(params: {
    projectId: string;
    userId?: string;
    traceId?: string;
    threadName: string;
    threadId: string;
    turnId: string;
    turnMode?: "plan";
    promptSummary?: string;
  }): Promise<{ turnNumber: number }>;
  syncTurnState?(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
  finalizeTurnState?(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
  onTurnAborted?(params: {
    projectId: string;
    threadName: string;
    turnId: string;
  }): Promise<void>;
}

