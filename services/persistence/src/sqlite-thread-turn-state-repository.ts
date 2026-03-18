import type { DatabaseSync } from "node:sqlite";

import type { ThreadTurnState, ThreadTurnStateRepository } from "../../orchestrator/src/contracts";

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
  constructor(private readonly db: DatabaseSync) {}

  private requireProjectId(projectId?: string): string {
    if (!projectId) throw new Error("ThreadTurnState.projectId is required");
    return projectId;
  }

  async get(projectId: string, threadName: string): Promise<ThreadTurnState | null> {
    return this.getSync(projectId, threadName);
  }

  getSync(projectId: string, threadName: string): ThreadTurnState | null {
    const row = this.db.prepare(
      `SELECT * FROM thread_turn_states WHERE project_id = ? AND thread_name = ?`
    ).get(projectId, threadName) as ThreadTurnStateRow | undefined;
    return row ? this.toState(row) : null;
  }

  async upsert(state: ThreadTurnState): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO thread_turn_states (
        project_id, chat_id, thread_name, active_turn_id, blocking_turn_id, last_completed_turn_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      this.requireProjectId(state.projectId),
      state.chatId ?? "",
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
      chatId: row.chat_id || undefined,
      threadName: row.thread_name,
      activeTurnId: row.active_turn_id ?? undefined,
      blockingTurnId: row.blocking_turn_id ?? undefined,
      lastCompletedTurnId: row.last_completed_turn_id ?? undefined,
      updatedAt: row.updated_at,
    };
  }
}
