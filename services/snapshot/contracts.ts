import type { TurnSnapshotRecord } from "./types";

export interface SnapshotRepository {
  save(record: TurnSnapshotRecord): Promise<void>;
  updateSummary(projectId: string, threadId: string, turnId: string, summary: string, files: string[]): Promise<void>;
  listByThread(projectId: string, threadId: string): Promise<TurnSnapshotRecord[]>;
  getByTurnId(projectId: string, turnId: string): Promise<TurnSnapshotRecord | null>;
  getLatestIndex(projectId: string, threadId: string): Promise<number>;
}
