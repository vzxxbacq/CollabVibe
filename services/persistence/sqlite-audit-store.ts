import type { AuditEventRecord, AuditStore } from "../audit/audit-service";

type DatabaseLike = {
    prepare(sql: string): {
        run(...params: unknown[]): void;
    };
};

/**
 * SQLite 实现 — 将审计事件写入 audit_logs 表。
 * 依赖 migrations.ts 已创建的 audit_logs 表及其扩展列（trace_id, detail_json, org_id）。
 */
export class SqliteAuditStore implements AuditStore {
    constructor(private readonly db: DatabaseLike) {}

    async append(record: AuditEventRecord): Promise<void> {
        this.db.prepare(
            `INSERT INTO audit_logs (id, project_id, actor_id, action, result, created_at, trace_id, detail_json, org_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            record.id,
            record.projectId,
            record.actorId,
            record.action,
            record.result,
            record.createdAt,
            record.traceId ?? null,
            record.detailJson ? JSON.stringify(record.detailJson) : null,
            record.orgId ?? null
        );
    }
}
