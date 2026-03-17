import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import type { BackendIdentity } from "../../../packages/agent-core/src/backend-identity";
import { createBackendIdentity, isBackendId } from "../../../packages/agent-core/src/backend-identity";
import type { ThreadListEntry, ThreadRecord, ThreadRegistry, ThreadReservation } from "../../orchestrator/src/thread-state/thread-registry";

interface ProjectThreadRow {
  thread_id: string;
  project_id: string;
  chat_id: string;
  thread_name: string;
  backend_name: string;
  transport: string;
  model: string | null;
  status: string;
}

function rowToRecord(row: ProjectThreadRow): ThreadRecord {
  const backendId = isBackendId(row.backend_name) ? row.backend_name : "codex";
  const backend: BackendIdentity = createBackendIdentity(backendId, row.model ?? "unknown");
  return {
    projectId: row.project_id,
    chatId: row.chat_id || undefined,
    threadName: row.thread_name,
    threadId: row.thread_id,
    backend,
  };
}

function rowToListEntry(row: ProjectThreadRow): ThreadListEntry {
  const backendId = isBackendId(row.backend_name) ? row.backend_name : "codex";
  const backend: BackendIdentity = createBackendIdentity(backendId, row.model ?? "unknown");
  return {
    projectId: row.project_id,
    chatId: row.chat_id || undefined,
    threadName: row.thread_name,
    threadId: row.status === "active" ? row.thread_id : undefined,
    status: row.status === "creating" ? "creating" : "active",
    backend,
  };
}

/**
 * SQLite-backed ThreadRegistry.
 *
 * Uses the `project_threads` table. No in-memory cache —
 * every read goes to SQLite to satisfy I3 (unique persistent source).
 */
export class SqliteThreadRegistry implements ThreadRegistry {
  constructor(private readonly db: DatabaseSync) {}

  private requireProjectId(projectId?: string): string {
    if (!projectId) throw new Error("ThreadRecord.projectId is required");
    return projectId;
  }

  private beginImmediate(): void {
    this.db.exec("BEGIN IMMEDIATE");
  }

  private commit(): void {
    this.db.exec("COMMIT");
  }

  private rollback(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch {
      // no-op
    }
  }

  private getActiveOrCreating(projectId: string, threadName: string): { thread_id: string; status: string } | undefined {
    return this.db.prepare(
      `SELECT thread_id, status
         FROM project_threads
        WHERE project_id = ? AND thread_name = ? AND status IN ('creating', 'active')
        LIMIT 1`
    ).get(projectId, threadName) as { thread_id: string; status: string } | undefined;
  }

  reserve(record: Omit<ThreadRecord, "threadId">): ThreadReservation {
    const projectId = this.requireProjectId(record.projectId);
    const reservationId = `resv:${randomUUID()}`;
    this.beginImmediate();
    try {
      const existing = this.getActiveOrCreating(projectId, record.threadName);
      if (existing) {
        throw new Error(`THREAD_ALREADY_EXISTS:${existing.status}`);
      }
      this.db.prepare(
        `INSERT INTO project_threads (thread_id, project_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'creating')`
      ).run(
        reservationId,
        projectId,
        record.chatId ?? "",
        record.threadName,
        record.backend.backendId,
        record.backend.transport,
        record.backend.model,
      );
      this.commit();
      return { reservationId, projectId, chatId: record.chatId, threadName: record.threadName };
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  activate(reservationId: string, record: ThreadRecord): void {
    const projectId = this.requireProjectId(record.projectId);
    this.beginImmediate();
    try {
      const result = this.db.prepare(
        `UPDATE project_threads
            SET thread_id = ?,
                project_id = ?,
                chat_id = ?,
                thread_name = ?,
                backend_name = ?,
                transport = ?,
                model = ?,
                status = 'active'
          WHERE thread_id = ? AND status = 'creating'`
      ).run(
        record.threadId,
        projectId,
        record.chatId ?? "",
        record.threadName,
        record.backend.backendId,
        record.backend.transport,
        record.backend.model,
        reservationId,
      );
      if ((result.changes ?? 0) !== 1) {
        throw new Error(`thread reservation not found: ${reservationId}`);
      }
      this.commit();
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  release(reservationId: string): void {
    this.db.prepare(
      `UPDATE project_threads
          SET status = 'failed'
        WHERE thread_id = ? AND status = 'creating'`
    ).run(reservationId);
  }

  register(record: ThreadRecord): void {
    const projectId = this.requireProjectId(record.projectId);
    this.beginImmediate();
    try {
      const existing = this.getActiveOrCreating(projectId, record.threadName);
      if (existing) {
        throw new Error(`THREAD_ALREADY_EXISTS:${existing.status}`);
      }
      this.db.prepare(
        `INSERT INTO project_threads (thread_id, project_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'active')`
      ).run(
        record.threadId,
        projectId,
        record.chatId ?? "",
        record.threadName,
        record.backend.backendId,
        record.backend.transport,
        record.backend.model,
      );
      this.commit();
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  get(projectId: string, threadName: string): ThreadRecord | null {
    const row = this.db
      .prepare(
         `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model
         , status
         FROM project_threads
         WHERE project_id = ? AND thread_name = ? AND status = 'active'`
      )
      .get(projectId, threadName) as ProjectThreadRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  list(projectId: string): ThreadRecord[] {
    const rows = this.db
      .prepare(
         `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model
         , status
         FROM project_threads
         WHERE project_id = ? AND status = 'active'`
      )
      .all(projectId) as unknown as ProjectThreadRow[];
    return rows.map(rowToRecord);
  }

  listEntries(projectId: string): ThreadListEntry[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model, status
         FROM project_threads
         WHERE project_id = ? AND status IN ('creating', 'active')`
      )
      .all(projectId) as unknown as ProjectThreadRow[];
    return rows.map(rowToListEntry);
  }

  listAll(): ThreadRecord[] {
    const rows = this.db
      .prepare(
        `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model, status
         FROM project_threads
         WHERE status = 'active'`
      )
      .all() as unknown as ProjectThreadRow[];
    return rows.map(rowToRecord);
  }

  remove(projectId: string, threadName: string): void {
    this.db
      .prepare(
        `UPDATE project_threads SET status = 'merged' WHERE project_id = ? AND thread_name = ? AND status = 'active'`
      )
      .run(projectId, threadName);
  }
}
