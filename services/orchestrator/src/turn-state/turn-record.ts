export type TurnStatus =
  | "running"
  | "awaiting_approval"
  | "completed"
  | "accepted"
  | "reverted"
  | "interrupted"
  | "failed";

export interface TurnTokenUsage {
  input: number;
  output: number;
  total?: number;
}

export interface TurnRecord {
  chatId: string;
  projectId: string;
  threadName: string;
  threadId: string;
  turnId: string;
  userId?: string;
  traceId?: string;
  status: TurnStatus;
  cwd: string;
  snapshotSha?: string;
  filesChanged?: string[];
  diffSummary?: string;
  stats?: { additions: number; deletions: number };
  approvalRequired: boolean;
  approvalResolvedAt?: string;
  lastAgentMessage?: string;
  tokenUsage?: TurnTokenUsage;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
