export type PersistedMergeFileStatus =
  | "auto_merged"
  | "conflict"
  | "added"
  | "deleted"
  | "agent_resolved"
  | "agent_pending";

export type PersistedMergeFileDecision =
  | "pending"
  | "accept"
  | "keep_main"
  | "use_branch"
  | "skip";

export interface PersistedMergeSessionFile {
  path: string;
  status: PersistedMergeFileStatus;
  diff: string;
  decision: PersistedMergeFileDecision;
  agentAttempts: number;
  lastFeedback?: string;
  agentResult?: string;
}

export interface PersistedMergeSessionRecord {
  projectId: string;
  chatId: string;
  branchName: string;
  baseBranch: string;
  mainCwd: string;
  worktreeCwd: string;
  preMergeSha: string;
  files: PersistedMergeSessionFile[];
  currentIndex: number;
  state: "reviewing" | "resolving" | "recovery_required";
  createdAt: number;
  updatedAt: number;
  recoveryError?: string;
  activeAgentFilePath?: string;
  agentRetryBaseline?: Record<string, string>;
  traceId?: string;
  threadId?: string;
  turnId?: string;
  userId?: string;
  resolverName?: string;
  resolverBackendId?: string;
  resolverModel?: string;
}

export interface MergeSessionRepository {
  get(projectId: string, branchName: string): Promise<PersistedMergeSessionRecord | null>;
  upsert(record: PersistedMergeSessionRecord): Promise<void>;
  delete(projectId: string, branchName: string): Promise<void>;
  listActive(projectIds: string[]): Promise<PersistedMergeSessionRecord[]>;
}
