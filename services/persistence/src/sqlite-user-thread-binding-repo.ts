import type { DatabaseSync } from "node:sqlite";

import type { UserThreadBinding, UserThreadBindingRepository } from "../../orchestrator/src/contracts";

interface BindingRow {
  project_id: string;
  user_id: string;
  thread_name: string;
  backend_session_id: string | null;
  codex_thread_id: string | null;
}

export class SqliteUserThreadBindingRepository implements UserThreadBindingRepository {
  constructor(private readonly db: DatabaseSync) {}

  private requireProjectId(projectId?: string): string {
    if (!projectId) {
      throw new Error("UserThreadBinding.projectId is required");
    }
    return projectId;
  }

  async bind(binding: UserThreadBinding): Promise<void> {
    this.db.prepare(
      `INSERT INTO user_thread_bindings (project_id, chat_id, user_id, thread_name, backend_session_id, codex_thread_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id, user_id)
       DO UPDATE SET
         chat_id = excluded.chat_id,
         thread_name = excluded.thread_name,
         backend_session_id = excluded.backend_session_id,
         codex_thread_id = excluded.codex_thread_id,
         updated_at = excluded.updated_at`
    ).run(this.requireProjectId(binding.projectId), "", binding.userId, binding.threadName, binding.threadId, binding.threadId);
  }

  async resolve(projectId: string, userId: string): Promise<UserThreadBinding | null> {
    const row = this.db.prepare(
      `SELECT project_id, user_id, thread_name, backend_session_id, codex_thread_id
       FROM user_thread_bindings
       WHERE project_id = ? AND user_id = ?`
    ).get(projectId, userId) as BindingRow | undefined;
    if (!row) return null;
    if (!row.backend_session_id) {
      throw new Error(`UserThreadBinding is corrupted: missing backend_session_id for project=${projectId} user=${userId}`);
    }
    return {
      projectId: row.project_id,
      userId: row.user_id,
      threadName: row.thread_name,
      threadId: row.backend_session_id
    };
  }

  async leave(projectId: string, userId: string): Promise<void> {
    this.db.prepare(
      `DELETE FROM user_thread_bindings WHERE project_id = ? AND user_id = ?`
    ).run(projectId, userId);
  }

  async rebindThread(projectId: string, threadName: string, oldThreadId: string, newThreadId: string): Promise<void> {
    this.db.prepare(
      `UPDATE user_thread_bindings
          SET backend_session_id = ?,
              codex_thread_id = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE project_id = ?
          AND thread_name = ?
          AND (backend_session_id = ? OR codex_thread_id = ?)`
    ).run(newThreadId, newThreadId, projectId, threadName, oldThreadId, oldThreadId);
  }
}
