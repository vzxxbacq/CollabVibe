import type { AsyncDatabaseProxy } from "./async-database-proxy";

import type { UserThreadBinding, UserThreadBindingRepository } from "../thread/user-thread-binding-types";

interface BindingRow {
  project_id: string;
  user_id: string;
  thread_name: string;
  thread_id: string | null;
}

export class SqliteUserThreadBindingRepository implements UserThreadBindingRepository {
  constructor(private readonly db: AsyncDatabaseProxy) {}

  private requireProjectId(projectId?: string): string {
    if (!projectId) {
      throw new Error("UserThreadBinding.projectId is required");
    }
    return projectId;
  }

  async bind(binding: UserThreadBinding): Promise<void> {
    await this.db.prepare(
      `INSERT INTO user_thread_bindings (project_id, chat_id, user_id, thread_name, thread_id, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id, user_id)
       DO UPDATE SET
         chat_id = excluded.chat_id,
         thread_name = excluded.thread_name,
         thread_id = excluded.thread_id,
         updated_at = excluded.updated_at`
    ).run(this.requireProjectId(binding.projectId), "", binding.userId, binding.threadName, binding.threadId);
  }

  async resolve(projectId: string, userId: string): Promise<UserThreadBinding | null> {
    const row = await this.db.get(
      `SELECT project_id, user_id, thread_name, thread_id
       FROM user_thread_bindings
       WHERE project_id = ? AND user_id = ?`,
      projectId, userId,
    ) as BindingRow | undefined;
    if (!row) return null;
    if (!row.thread_id) {
      throw new Error(`UserThreadBinding is corrupted: missing thread_id for project=${projectId} user=${userId}`);
    }
    return {
      projectId: row.project_id,
      userId: row.user_id,
      threadName: row.thread_name,
      threadId: row.thread_id
    };
  }

  async leave(projectId: string, userId: string): Promise<void> {
    await this.db.prepare(
      `DELETE FROM user_thread_bindings WHERE project_id = ? AND user_id = ?`
    ).run(projectId, userId);
  }

  async rebindThread(projectId: string, threadName: string, oldThreadId: string, newThreadId: string): Promise<void> {
    await this.db.prepare(
      `UPDATE user_thread_bindings
          SET thread_id = ?,
              updated_at = CURRENT_TIMESTAMP
        WHERE project_id = ?
          AND thread_name = ?
          AND thread_id = ?`
    ).run(newThreadId, projectId, threadName, oldThreadId);
  }
}
