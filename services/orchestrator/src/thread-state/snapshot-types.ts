/**
 * TurnSnapshotRecord — snapshot/materialization record only.
 *
 * It exists for snapshot history / restore navigation and is NOT
 * the source of truth for turn lifecycle, approval, or blocking state.
 * Those now live in TurnRecord / ThreadTurnState.
 */
export interface TurnSnapshotRecord {
  projectId?: string;
  /** @deprecated routing alias only — persistent ownership is projectId */
  chatId?: string;
  threadId: string;
  turnId: string;
  turnIndex: number;
  userId?: string;
  cwd: string;
  gitRef: string;
  agentSummary?: string;
  filesChanged?: string[];
  createdAt: string;
}

export interface SnapshotRepository {
  save(record: TurnSnapshotRecord): Promise<void>;
  updateSummary(projectId: string, threadId: string, turnId: string, summary: string, files: string[]): Promise<void>;
  listByThread(projectId: string, threadId: string): Promise<TurnSnapshotRecord[]>;
  getByTurnId(projectId: string, turnId: string): Promise<TurnSnapshotRecord | null>;
  getLatestIndex(projectId: string, threadId: string): Promise<number>;
}
