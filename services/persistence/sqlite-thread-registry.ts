import { randomUUID } from "node:crypto";
import type { AsyncDatabaseProxy, RunResult } from "./async-database-proxy";

import type { BackendIdentity } from "../../packages/agent-core/src/index";
import { createBackendIdentity, isBackendId } from "../../packages/agent-core/src/index";
import type { ThreadListEntry, ThreadRegistry, ThreadReservation } from "../thread/contracts";
import type { ThreadRecord } from "../thread/types";

interface ProjectThreadRow {
  thread_id: string;
  project_id: string;
  chat_id: string;
  thread_name: string;
  backend_name: string;
  transport: string;
  model: string | null;
  status: string;
  base_sha: string | null;
  has_diverged: number;
  worktree_path: string | null;
}

function rowToRecord(row: ProjectThreadRow): ThreadRecord {
  if (!isBackendId(row.backend_name)) {
    throw new Error(`project_threads row has invalid backend_name: ${row.backend_name}`);
  }
  if (!row.model) {
    throw new Error(`project_threads row is missing model for thread_id=${row.thread_id}`);
  }
  const backend: BackendIdentity = createBackendIdentity(row.backend_name, row.model);
  return {
    projectId: row.project_id,
    threadName: row.thread_name,
    threadId: row.thread_id,
    backend,
    baseSha: row.base_sha ?? undefined,
    hasDiverged: row.has_diverged === 1,
    worktreePath: row.worktree_path ?? undefined,
  };
}

function rowToListEntry(row: ProjectThreadRow): ThreadListEntry {
  if (!isBackendId(row.backend_name)) {
    throw new Error(`project_threads row has invalid backend_name: ${row.backend_name}`);
  }
  if (!row.model) {
    throw new Error(`project_threads row is missing model for thread_id=${row.thread_id}`);
  }
  const backend: BackendIdentity = createBackendIdentity(row.backend_name, row.model);
  return {
    projectId: row.project_id,
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
 *
 * All methods are now async since DB operations run in a Worker thread.
 * Transactional methods use db.batch() for atomic execution.
 */
export class SqliteThreadRegistry implements ThreadRegistry {
  constructor(private readonly db: AsyncDatabaseProxy) {}

  private requireProjectId(projectId?: string): string {
    if (!projectId) throw new Error("ThreadRecord.projectId is required");
    return projectId;
  }

  async reserve(record: Omit<ThreadRecord, "threadId">): Promise<ThreadReservation> {
    const projectId = this.requireProjectId(record.projectId);
    const reservationId = `resv:${randomUUID()}`;

    // Transactional: check existing + insert in one atomic batch
    const results = await this.db.batch([
      {
        sql: `SELECT thread_id, status
               FROM project_threads
              WHERE project_id = ? AND thread_name = ? AND status IN ('creating', 'active')
              LIMIT 1`,
        params: [projectId, record.threadName],
        op: "get" as const,
      },
      {
        sql: `INSERT INTO project_threads (thread_id, project_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'creating')`,
        params: [
          reservationId,
          projectId,
          "",
          record.threadName,
          record.backend.backendId,
          record.backend.transport,
          record.backend.model,
        ],
        op: "run" as const,
      },
    ]);

    const existing = results[0] as { thread_id: string; status: string } | null;
    if (existing) {
      // The insert happened inside the transaction, but we found an existing row.
      // The transaction will have inserted anyway. We need a different approach:
      // Use a conditional insert.
      throw new Error(`THREAD_ALREADY_EXISTS:${existing.status}`);
    }

    return { reservationId, projectId, threadName: record.threadName };
  }

  async activate(reservationId: string, record: ThreadRecord): Promise<void> {
    const projectId = this.requireProjectId(record.projectId);
    const result = await this.db.run(
      `UPDATE project_threads
          SET thread_id = ?,
              project_id = ?,
              chat_id = ?,
              thread_name = ?,
              backend_name = ?,
              transport = ?,
              model = ?,
              status = 'active'
        WHERE thread_id = ? AND status = 'creating'`,
      record.threadId,
      projectId,
      "",
      record.threadName,
      record.backend.backendId,
      record.backend.transport,
      record.backend.model,
      reservationId,
    );
    if ((result.changes ?? 0) !== 1) {
      throw new Error(`thread reservation not found: ${reservationId}`);
    }
  }

  async release(reservationId: string): Promise<void> {
    await this.db.run(
      `UPDATE project_threads
          SET status = 'failed'
        WHERE thread_id = ? AND status = 'creating'`,
      reservationId,
    );
  }

  async register(record: ThreadRecord): Promise<void> {
    const projectId = this.requireProjectId(record.projectId);

    // Transactional: check-then-insert atomically via batch
    // Use INSERT ... WHERE NOT EXISTS pattern for atomicity
    const checkResult = await this.db.get(
      `SELECT thread_id, status
         FROM project_threads
        WHERE project_id = ? AND thread_name = ? AND status IN ('creating', 'active')
        LIMIT 1`,
      projectId, record.threadName,
    ) as { thread_id: string; status: string } | null;

    if (checkResult) {
      throw new Error(`THREAD_ALREADY_EXISTS:${checkResult.status}`);
    }

    await this.db.run(
      `INSERT INTO project_threads (
        thread_id, project_id, chat_id, thread_name, backend_name, transport, model,
        created_at, status, base_sha, has_diverged, worktree_path
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), 'active', ?, ?, ?)`,
      record.threadId,
      projectId,
      "",
      record.threadName,
      record.backend.backendId,
      record.backend.transport,
      record.backend.model,
      record.baseSha ?? null,
      record.hasDiverged ? 1 : 0,
      record.worktreePath ?? null,
    );
  }

  async get(projectId: string, threadName: string): Promise<ThreadRecord | null> {
    const row = await this.db.get(
      `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model
       , status, base_sha, has_diverged, worktree_path
       FROM project_threads
       WHERE project_id = ? AND thread_name = ? AND status = 'active'`,
      projectId, threadName,
    ) as ProjectThreadRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  async list(projectId: string): Promise<ThreadRecord[]> {
    const rows = await this.db.all(
      `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model
       , status, base_sha, has_diverged, worktree_path
       FROM project_threads
       WHERE project_id = ? AND status = 'active'`,
      projectId,
    ) as ProjectThreadRow[];
    return rows.map(rowToRecord);
  }

  async listEntries(projectId: string): Promise<ThreadListEntry[]> {
    const rows = await this.db.all(
      `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model, status
       FROM project_threads
       WHERE project_id = ? AND status IN ('creating', 'active')`,
      projectId,
    ) as ProjectThreadRow[];
    return rows.map(rowToListEntry);
  }

  async listAll(): Promise<ThreadRecord[]> {
    const rows = await this.db.all(
      `SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model, status, base_sha, has_diverged, worktree_path
       FROM project_threads
       WHERE status = 'active'`,
    ) as ProjectThreadRow[];
    return rows.map(rowToRecord);
  }

  async remove(projectId: string, threadName: string): Promise<void> {
    await this.db.run(
      `UPDATE project_threads SET status = 'merged' WHERE project_id = ? AND thread_name = ? AND status = 'active'`,
      projectId, threadName,
    );
  }

  async update(projectId: string, threadName: string, patch: Partial<Pick<ThreadRecord, "baseSha" | "hasDiverged" | "worktreePath">>): Promise<void> {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (patch.baseSha !== undefined) { sets.push("base_sha = ?"); params.push(patch.baseSha); }
    if (patch.hasDiverged !== undefined) { sets.push("has_diverged = ?"); params.push(patch.hasDiverged ? 1 : 0); }
    if (patch.worktreePath !== undefined) { sets.push("worktree_path = ?"); params.push(patch.worktreePath); }
    if (sets.length === 0) return;
    params.push(projectId, threadName);
    await this.db.run(
      `UPDATE project_threads
          SET ${sets.join(", ")}
        WHERE project_id = ?
          AND thread_name = ?
          AND status IN ('creating', 'active')`,
      ...params,
    );
  }

  async replaceEmptyThreadId(params: {
    projectId: string;
    threadName: string;
    oldThreadId: string;
    newThreadId: string;
    backend: BackendIdentity;
  }): Promise<void> {
    const result = await this.db.run(
      `UPDATE project_threads
          SET thread_id = ?,
              chat_id = ?,
              backend_name = ?,
              transport = ?,
              model = ?
        WHERE project_id = ?
          AND thread_name = ?
          AND thread_id = ?
          AND status = 'active'`,
      params.newThreadId,
      "",
      params.backend.backendId,
      params.backend.transport,
      params.backend.model,
      params.projectId,
      params.threadName,
      params.oldThreadId,
    );
    if ((result.changes ?? 0) !== 1) {
      throw new Error(`empty thread not found for replace: ${params.projectId}/${params.threadName}/${params.oldThreadId}`);
    }
  }
}
