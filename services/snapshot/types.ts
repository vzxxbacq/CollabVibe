/**
 * @module services/snapshot/types
 *
 * Snapshot 数据类型 — 定义权在 contracts 层。
 *
 * 本文件是 TurnSnapshotRecord 的唯一定义来源。
 * L1 通过 OrchestratorApi 的 listSnapshots / jumpToSnapshot 等方法获取实例，
 * L2 import 此类型用于持久化和 snapshot 导航逻辑。
 *
 * @see docs/01-architecture/core-api.md §4 Snapshot 管理
 */

/**
 * TurnSnapshotRecord — snapshot/物化记录。
 *
 * 用于 snapshot 历史/恢复导航，不是 turn 生命周期、审批或阻塞状态的真实来源。
 * 那些信息现在由 TurnRecord / ThreadTurnState 管理。
 */
export interface TurnSnapshotRecord {
  projectId?: string;
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
