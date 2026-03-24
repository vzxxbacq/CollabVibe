import type { AsyncDatabaseProxy } from "./async-database-proxy";

import type { ThreadTurnState } from "../thread/thread-turn-state";
import type { ThreadTurnStateRepository } from "../thread/thread-turn-state-repository";

interface ThreadTurnStateRow {
  project_id: string;
  chat_id: string;
  thread_name: string;
  active_turn_id: string | null;
  blocking_turn_id: string | null;
  last_completed_turn_id: string | null;
  updated_at: string;
}

export class SqliteThreadTurnStateRepository implements ThreadTurnStateRepository {
  constructor(private readonly db: AsyncDatabaseProxy) {}

  private requireProjectId(projectId?: string): string {
    if (!projectId) throw new Error("ThreadTurnState.projectId is required");
    return projectId;
  }

  async get(projectId: string, threadName: string): Promise<ThreadTurnState | null> {
    const row = await this.db.get(
      `SELECT * FROM thread_turn_states WHERE project_id = ? AND thread_name = ?`,
      projectId, threadName,
    ) as ThreadTurnStateRow | undefined;
    return row ? this.toState(row) : null;
  }

  async upsert(state: ThreadTurnState): Promise<void> {
    await this.db.prepare(
      `INSERT OR REPLACE INTO thread_turn_states (
        project_id, chat_id, thread_name, active_turn_id, blocking_turn_id, last_completed_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      this.requireProjectId(state.projectId),
      "",
      state.threadName,
      state.activeTurnId ?? null,
      state.blockingTurnId ?? null,
      state.lastCompletedTurnId ?? null,
      state.updatedAt,
    );
  }

  private toState(row: ThreadTurnStateRow): ThreadTurnState {
    return {
      projectId: row.project_id,
      threadName: row.thread_name,
      activeTurnId: row.active_turn_id ?? undefined,
      blockingTurnId: row.blocking_turn_id ?? undefined,
      lastCompletedTurnId: row.last_completed_turn_id ?? undefined,
      updatedAt: row.updated_at,
    };
  }
}
