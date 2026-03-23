/**
 * TurnSnapshotRecord 定义权在 contracts/src/types/snapshot.ts（唯一来源）。
 * 此处 import + re-export 保持 orchestrator 内部消费者的 import 路径兼容。
 *
 * SnapshotRepository 接口是 L2 内部协议，保留在此文件。
 */
import type { TurnSnapshotRecord } from "../../../../services/contracts/src/types/snapshot";
export type { TurnSnapshotRecord };

export interface SnapshotRepository {
  save(record: TurnSnapshotRecord): Promise<void>;
  updateSummary(projectId: string, threadId: string, turnId: string, summary: string, files: string[]): Promise<void>;
  listByThread(projectId: string, threadId: string): Promise<TurnSnapshotRecord[]>;
  getByTurnId(projectId: string, turnId: string): Promise<TurnSnapshotRecord | null>;
  getLatestIndex(projectId: string, threadId: string): Promise<number>;
}
