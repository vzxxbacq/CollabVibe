import type { DatabaseSync } from "node:sqlite";

import type {
  MergeSessionRepository,
  PersistedMergeSessionRecord,
} from "../../orchestrator/src/contracts";

interface MergeSessionRow {
  project_id: string;
  chat_id: string;
  branch_name: string;
  base_branch: string;
  main_cwd: string;
  worktree_cwd: string;
  pre_merge_sha: string;
  files_json: string;
  current_index: number;
  state: "reviewing" | "resolving" | "recovery_required";
  created_at: number;
  updated_at: number;
  active_agent_file_path: string | null;
  agent_retry_baseline_json: string | null;
  trace_id: string | null;
  thread_id: string | null;
  turn_id: string | null;
  user_id: string | null;
  resolver_name: string | null;
  resolver_backend_id: string | null;
  resolver_model: string | null;
  recovery_error: string | null;
}

export class SqliteMergeSessionRepository implements MergeSessionRepository {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS merge_sessions (
        project_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        base_branch TEXT NOT NULL,
        main_cwd TEXT NOT NULL,
        worktree_cwd TEXT NOT NULL,
        pre_merge_sha TEXT NOT NULL,
        files_json TEXT NOT NULL,
        current_index INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        active_agent_file_path TEXT,
        agent_retry_baseline_json TEXT,
        trace_id TEXT,
        thread_id TEXT,
        turn_id TEXT,
        user_id TEXT,
        resolver_name TEXT,
        resolver_backend_id TEXT,
        resolver_model TEXT,
        recovery_error TEXT,
        PRIMARY KEY(project_id, branch_name)
      );`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_merge_sessions_project_state
       ON merge_sessions(project_id, state);`
    );
  }

  async get(projectId: string, branchName: string): Promise<PersistedMergeSessionRecord | null> {
    const row = this.db.prepare(
      `SELECT * FROM merge_sessions WHERE project_id = ? AND branch_name = ?`
    ).get(projectId, branchName) as MergeSessionRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  async upsert(record: PersistedMergeSessionRecord): Promise<void> {
    this.db.prepare(
      `INSERT OR REPLACE INTO merge_sessions (
        project_id, chat_id, branch_name, base_branch, main_cwd, worktree_cwd,
        pre_merge_sha, files_json, current_index, state, created_at, updated_at,
        active_agent_file_path, agent_retry_baseline_json, trace_id, thread_id,
        turn_id, user_id, resolver_name, resolver_backend_id, resolver_model, recovery_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.projectId,
      record.chatId,
      record.branchName,
      record.baseBranch,
      record.mainCwd,
      record.worktreeCwd,
      record.preMergeSha,
      JSON.stringify(record.files),
      record.currentIndex,
      record.state,
      record.createdAt,
      record.updatedAt,
      record.activeAgentFilePath ?? null,
      record.agentRetryBaseline ? JSON.stringify(record.agentRetryBaseline) : null,
      record.traceId ?? null,
      record.threadId ?? null,
      record.turnId ?? null,
      record.userId ?? null,
      record.resolverName ?? null,
      record.resolverBackendId ?? null,
      record.resolverModel ?? null,
      record.recoveryError ?? null,
    );
  }

  async delete(projectId: string, branchName: string): Promise<void> {
    this.db.prepare(
      `DELETE FROM merge_sessions WHERE project_id = ? AND branch_name = ?`
    ).run(projectId, branchName);
  }

  async listActive(projectIds: string[]): Promise<PersistedMergeSessionRecord[]> {
    if (projectIds.length === 0) return [];
    const placeholders = projectIds.map(() => "?").join(", ");
    const rows = this.db.prepare(
      `SELECT * FROM merge_sessions WHERE project_id IN (${placeholders})`
    ).all(...projectIds) as unknown as MergeSessionRow[];
    return rows.map((row) => this.toRecord(row));
  }

  private toRecord(row: MergeSessionRow): PersistedMergeSessionRecord {
    return {
      projectId: row.project_id,
      chatId: row.chat_id,
      branchName: row.branch_name,
      baseBranch: row.base_branch,
      mainCwd: row.main_cwd,
      worktreeCwd: row.worktree_cwd,
      preMergeSha: row.pre_merge_sha,
      files: JSON.parse(row.files_json),
      currentIndex: row.current_index,
      state: row.state,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      activeAgentFilePath: row.active_agent_file_path ?? undefined,
      agentRetryBaseline: row.agent_retry_baseline_json ? JSON.parse(row.agent_retry_baseline_json) : undefined,
      traceId: row.trace_id ?? undefined,
      threadId: row.thread_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      userId: row.user_id ?? undefined,
      resolverName: row.resolver_name ?? undefined,
      resolverBackendId: row.resolver_backend_id ?? undefined,
      resolverModel: row.resolver_model ?? undefined,
      recoveryError: row.recovery_error ?? undefined,
    };
  }
}
