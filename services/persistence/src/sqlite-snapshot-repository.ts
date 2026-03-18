import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import type { TurnSnapshotRecord, SnapshotRepository } from "../../orchestrator/src/contracts";

interface SqliteSnapshotRow {
    id: number;
    project_id: string;
    chat_id: string;
    thread_id: string;
    turn_id: string;
    turn_index: number;
    user_id: string | null;
    cwd: string;
    git_ref: string;
    agent_summary: string | null;
    files_changed: string | null;
    created_at: string;
}

export class SqliteSnapshotRepository implements SnapshotRepository {
    private readonly db: DatabaseSync;

    constructor(db: DatabaseSync) {
        this.db = db;
    }

    private getOne(sql: string, ...params: SQLInputValue[]): SqliteSnapshotRow | undefined {
        return this.db.prepare(sql).get(...params) as SqliteSnapshotRow | undefined;
    }

    private getMany(sql: string, ...params: SQLInputValue[]): SqliteSnapshotRow[] {
        return this.db.prepare(sql).all(...params) as unknown as SqliteSnapshotRow[];
    }

    private requireProjectId(projectId?: string): string {
        if (!projectId) {
            throw new Error("TurnSnapshotRecord.projectId is required");
        }
        return projectId;
    }

    async save(record: TurnSnapshotRecord): Promise<void> {
        this.db
            .prepare(
                `INSERT OR IGNORE INTO turn_snapshots
         (project_id, chat_id, thread_id, turn_id, turn_index, user_id, cwd, git_ref, agent_summary, files_changed, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
                this.requireProjectId(record.projectId),
                record.chatId ?? "",
                record.threadId,
                record.turnId,
                record.turnIndex,
                record.userId ?? null,
                record.cwd,
                record.gitRef,
                record.agentSummary ?? null,
                record.filesChanged ? JSON.stringify(record.filesChanged) : null,
                record.createdAt
            );
    }

    async updateSummary(projectId: string, threadId: string, turnId: string, summary: string, files: string[]): Promise<void> {
        this.db
            .prepare(
                `UPDATE turn_snapshots
         SET agent_summary = ?, files_changed = ?
         WHERE project_id = ? AND thread_id = ? AND turn_id = ?`
            )
            .run(summary, JSON.stringify(files), projectId, threadId, turnId);
    }

    async listByThread(projectId: string, threadId: string): Promise<TurnSnapshotRecord[]> {
        const rows = this.getMany(
            `SELECT * FROM turn_snapshots
             WHERE project_id = ? AND thread_id = ?
             ORDER BY turn_index ASC`,
            projectId, threadId
        );
        return rows.map((r) => this.toRecord(r));
    }

    async getByTurnId(projectId: string, turnId: string): Promise<TurnSnapshotRecord | null> {
        const row = this.getOne(
            `SELECT * FROM turn_snapshots WHERE project_id = ? AND turn_id = ?`,
            projectId, turnId
        );
        return row ? this.toRecord(row) : null;
    }

    async getLatestIndex(projectId: string, threadId: string): Promise<number> {
        const row = this.db
            .prepare(
                `SELECT MAX(turn_index) as max_index FROM turn_snapshots
                 WHERE project_id = ? AND thread_id = ?`
            )
            .get(projectId, threadId) as { max_index: number | null } | undefined;
        return row?.max_index ?? -1;
    }

    private toRecord(row: SqliteSnapshotRow): TurnSnapshotRecord {
        return {
            projectId: row.project_id,
            chatId: row.chat_id || undefined,
            threadId: row.thread_id,
            turnId: row.turn_id,
            turnIndex: row.turn_index,
            userId: row.user_id ?? undefined,
            cwd: row.cwd,
            gitRef: row.git_ref,
            agentSummary: row.agent_summary ?? undefined,
            filesChanged: row.files_changed ? (JSON.parse(row.files_changed) as string[]) : undefined,
            createdAt: row.created_at
        };
    }
}
