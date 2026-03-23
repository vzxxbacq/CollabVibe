import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { TurnRecord, TurnStatus } from "../turn/types";
import type { TurnRepository } from "../turn/turn-repository";

interface TurnRow {
  chat_id: string;
  project_id: string;
  thread_name: string;
  thread_id: string;
  turn_id: string;
  call_id: string | null;
  platform: string | null;
  source_message_id: string | null;
  user_id: string | null;
  trace_id: string | null;
  status: TurnStatus;
  cwd: string;
  snapshot_sha: string | null;
  files_changed: string | null;
  diff_summary: string | null;
  stats_json: string | null;
  approval_required: number;
  approval_resolved_at: string | null;
  last_agent_message: string | null;
  token_usage_json: string | null;
  turn_number: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class SqliteTurnRepository implements TurnRepository {
  constructor(private readonly db: DatabaseSync) { }

  private getOneByProject(sql: string, ...params: SQLInputValue[]): TurnRow | undefined {
    return this.db.prepare(sql).get(...params) as TurnRow | undefined;
  }

  private getManyByProject(sql: string, ...params: SQLInputValue[]): TurnRow[] {
    return this.db.prepare(sql).all(...params) as unknown as TurnRow[];
  }

  async create(record: TurnRecord): Promise<void> {
    this.db.prepare(
      `INSERT INTO turn_records (
        project_id, chat_id, thread_name, thread_id, turn_id, call_id, platform, source_message_id, user_id, trace_id, status,
        cwd, snapshot_sha, files_changed, diff_summary, stats_json, approval_required,
        approval_resolved_at, last_agent_message, token_usage_json, turn_number, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, turn_id) DO UPDATE SET
        chat_id = excluded.chat_id,
        thread_name = excluded.thread_name,
        thread_id = excluded.thread_id,
        call_id = excluded.call_id,
        platform = excluded.platform,
        source_message_id = excluded.source_message_id,
        user_id = excluded.user_id,
        trace_id = excluded.trace_id,
        status = excluded.status,
        cwd = excluded.cwd,
        snapshot_sha = excluded.snapshot_sha,
        files_changed = excluded.files_changed,
        diff_summary = excluded.diff_summary,
        stats_json = excluded.stats_json,
        approval_required = excluded.approval_required,
        approval_resolved_at = excluded.approval_resolved_at,
        last_agent_message = excluded.last_agent_message,
        token_usage_json = excluded.token_usage_json,
        turn_number = excluded.turn_number,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at`
    ).run(
      record.projectId,
      "",
      record.threadName,
      record.threadId,
      record.turnId,
      record.callId ?? null,
      record.platform ?? null,
      record.sourceMessageId ?? null,
      record.userId ?? null,
      record.traceId ?? null,
      record.status,
      record.cwd,
      record.snapshotSha ?? null,
      record.filesChanged ? JSON.stringify(record.filesChanged) : null,
      record.diffSummary ?? null,
      record.stats ? JSON.stringify(record.stats) : null,
      record.approvalRequired ? 1 : 0,
      record.approvalResolvedAt ?? null,
      record.lastAgentMessage ?? null,
      record.tokenUsage ? JSON.stringify(record.tokenUsage) : null,
      record.turnNumber ?? null,
      record.createdAt,
      record.updatedAt,
      record.completedAt ?? null,
    );
  }

  async update(record: TurnRecord): Promise<void> {
    await this.create(record);
  }

  async getByTurnId(projectId: string, turnId: string): Promise<TurnRecord | null> {
    return this.getByTurnIdSync(projectId, turnId);
  }

  async getByCallId(projectId: string, callId: string): Promise<TurnRecord | null> {
    return this.getByCallIdSync(projectId, callId);
  }

  getByTurnIdSync(projectId: string, turnId: string): TurnRecord | null {
    const row = this.getOneByProject(
      `SELECT * FROM turn_records WHERE project_id = ? AND turn_id = ?`,
      projectId, turnId
    );
    return row ? this.toRecord(row) : null;
  }

  getByCallIdSync(projectId: string, callId: string): TurnRecord | null {
    const row = this.getOneByProject(
      `SELECT * FROM turn_records WHERE project_id = ? AND call_id = ?`,
      projectId, callId
    );
    return row ? this.toRecord(row) : null;
  }

  async listByThread(projectId: string, threadName: string, limit = 20): Promise<TurnRecord[]> {
    const rows = this.getManyByProject(
      `SELECT * FROM turn_records
       WHERE project_id = ? AND thread_name = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      projectId, threadName, limit
    );
    return rows.map((row) => this.toRecord(row));
  }

  async listByProject(projectId: string, limit = 20): Promise<TurnRecord[]> {
    const rows = this.getManyByProject(
      `SELECT * FROM turn_records
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      projectId, limit
    );
    return rows.map((row) => this.toRecord(row));
  }

  async findBlockingTurn(projectId: string, threadName: string): Promise<TurnRecord | null> {
    const row = this.getOneByProject(
      `SELECT * FROM turn_records
       WHERE project_id = ? AND thread_name = ? AND status IN ('running', 'awaiting_approval')
       ORDER BY updated_at DESC
       LIMIT 1`,
      projectId, threadName
    );
    return row ? this.toRecord(row) : null;
  }

  async getLastCompletedTurn(projectId: string, threadName: string): Promise<TurnRecord | null> {
    const row = this.getOneByProject(
      `SELECT * FROM turn_records
       WHERE project_id = ? AND thread_name = ? AND status IN ('completed', 'awaiting_approval', 'accepted')
       ORDER BY COALESCE(completed_at, updated_at) DESC
       LIMIT 1`,
      projectId, threadName
    );
    return row ? this.toRecord(row) : null;
  }

  async getMaxTurnNumber(projectId: string, threadName: string): Promise<number> {
    const row = this.db.prepare(
      `SELECT MAX(turn_number) as max_num FROM turn_records WHERE project_id = ? AND thread_name = ?`
    ).get(projectId, threadName) as { max_num: number | null } | undefined;
    return row?.max_num ?? 0;
  }

  private toRecord(row: TurnRow): TurnRecord {
    return {
      projectId: row.project_id,
      threadName: row.thread_name,
      threadId: row.thread_id,
      turnId: row.turn_id,
      callId: row.call_id ?? undefined,
      platform: row.platform ?? undefined,
      sourceMessageId: row.source_message_id ?? undefined,
      userId: row.user_id ?? undefined,
      traceId: row.trace_id ?? undefined,
      status: row.status,
      cwd: row.cwd,
      snapshotSha: row.snapshot_sha ?? undefined,
      filesChanged: row.files_changed ? JSON.parse(row.files_changed) as string[] : undefined,
      diffSummary: row.diff_summary ?? undefined,
      stats: row.stats_json ? JSON.parse(row.stats_json) as { additions: number; deletions: number } : undefined,
      approvalRequired: row.approval_required === 1,
      approvalResolvedAt: row.approval_resolved_at ?? undefined,
      lastAgentMessage: row.last_agent_message ?? undefined,
      tokenUsage: row.token_usage_json ? JSON.parse(row.token_usage_json) as { input: number; output: number; total?: number } : undefined,
      turnNumber: row.turn_number ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
