import type { MergeFileDecision, MergeFileStatus } from "../event/im-output";

export interface MergeSessionFile {
  path: string;
  status: MergeFileStatus;
  diff: string;
  decision: MergeFileDecision | "pending";
  agentAttempts: number;
  lastFeedback?: string;
  agentResult?: string;
}

export interface MergeSession {
  projectId: string;
  chatId: string;
  branchName: string;
  baseBranch: string;
  mainCwd: string;
  worktreeCwd: string;
  preMergeSha: string;
  files: MergeSessionFile[];
  currentIndex: number;
  state: "resolving" | "reviewing" | "recovery_required";
  createdAt: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  activeAgentFilePath?: string;
  agentRetryBaseline?: Record<string, string>;
  traceId?: string;
  threadId?: string;
  turnId?: string;
  userId?: string;
  resolverName?: string;
  resolverBackendId?: string;
  resolverModel?: string;
  recoveryError?: string;
}

export interface MergeRuntimeContext {
  traceId?: string;
  threadId?: string;
  turnId?: string;
  userId?: string;
  resolverName?: string;
}
