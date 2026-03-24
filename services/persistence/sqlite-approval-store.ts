import type { AsyncDatabaseProxy } from "./async-database-proxy";

import type {
  ApprovalDecision,
  ApprovalDecisionStore,
  ApprovalDisplaySnapshot,
  ApprovalRecord,
  ApprovalStatus,
} from "../approval/contracts";

interface ApprovalRow {
  id: string;
  backend_approval_id: string;
  project_id: string;
  thread_id: string;
  thread_name: string;
  turn_id: string;
  call_id: string;
  approval_type: "command_exec" | "file_change";
  status: ApprovalStatus;
  decision: string;
  actor_id: string;
  created_at: string;
  resolved_at: string | null;
  expired_at: string | null;
  status_reason: string;
  display_json: string;
}

export class SqliteApprovalStore implements ApprovalDecisionStore {
  constructor(private readonly db: AsyncDatabaseProxy) {}

  async create(record: ApprovalRecord): Promise<void> {
    await this.db.prepare(
      `INSERT INTO approvals (
        id, backend_approval_id, project_id, thread_id, thread_name, turn_id, call_id,
        approval_type, status, decision, actor_id, created_at, resolved_at, expired_at, status_reason, display_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        backend_approval_id = excluded.backend_approval_id,
        project_id = excluded.project_id,
        thread_id = excluded.thread_id,
        thread_name = excluded.thread_name,
        turn_id = excluded.turn_id,
        call_id = excluded.call_id,
        approval_type = excluded.approval_type,
        status = excluded.status,
        display_json = excluded.display_json`
    ).run(
      record.approvalId,
      record.backendApprovalId,
      record.projectId,
      record.threadId,
      record.threadName,
      record.turnId,
      record.callId,
      record.approvalType,
      record.status,
      record.decision ?? "",
      record.actorId ?? "",
      record.createdAt,
      record.resolvedAt ?? null,
      record.expiredAt ?? null,
      record.statusReason ?? "",
      JSON.stringify(record.display)
    );
  }

  async markResolved(decision: ApprovalDecision): Promise<ApprovalRecord | null> {
    const existing = await this.getById(decision.approvalId);
    if (!existing) return null;
    const resolvedAt = new Date().toISOString();
    const status: ApprovalStatus = decision.action === "approve"
      ? "approved"
      : decision.action === "deny"
        ? "denied"
        : "approved_always";
    await this.db.prepare(
      `UPDATE approvals
       SET status = ?, decision = ?, actor_id = ?, resolved_at = ?, expired_at = NULL, status_reason = ''
       WHERE id = ?`
    ).run(status, decision.action, decision.approverId, resolvedAt, decision.approvalId);
    return {
      ...existing,
      status,
      decision: decision.action,
      actorId: decision.approverId,
      resolvedAt,
      expiredAt: undefined,
    };
  }

  async markExpired(approvalId: string, expiredAt = new Date().toISOString(), reason = ""): Promise<ApprovalRecord | null> {
    const existing = await this.getById(approvalId);
    if (!existing) return null;
    await this.db.prepare(
      `UPDATE approvals
       SET status = 'expired', expired_at = ?, status_reason = ?
       WHERE id = ? AND status = 'pending'`
    ).run(expiredAt, reason, approvalId);
    const updated = await this.getById(approvalId);
    return updated ?? { ...existing, status: "expired", expiredAt, statusReason: reason };
  }

  async expirePending(projectIds?: string[], reason = "service restart cleared pending approvals", expiredAt = new Date().toISOString()): Promise<number> {
    if (projectIds && projectIds.length === 0) return 0;
    if (projectIds && projectIds.length > 0) {
      const placeholders = projectIds.map(() => "?").join(", ");
      const result = await this.db.run(
        `UPDATE approvals
         SET status = 'expired', expired_at = ?, status_reason = ?
         WHERE status = 'pending' AND project_id IN (${placeholders})`,
        expiredAt, reason, ...projectIds,
      );
      return Number(result.changes ?? 0);
    }
    const result = await this.db.run(
      `UPDATE approvals
       SET status = 'expired', expired_at = ?, status_reason = ?
       WHERE status = 'pending'`,
      expiredAt, reason,
    );
    return Number(result.changes ?? 0);
  }

  async getById(approvalId: string): Promise<ApprovalRecord | null> {
    const row = await this.db.get(
      `SELECT id, backend_approval_id, project_id, thread_id, thread_name, turn_id, call_id,
              approval_type, status, decision, actor_id, created_at, resolved_at, expired_at, status_reason, display_json
       FROM approvals WHERE id = ?`,
      approvalId,
    ) as ApprovalRow | undefined;
    if (!row) return null;
    let display: ApprovalDisplaySnapshot;
    try {
      display = JSON.parse(row.display_json) as ApprovalDisplaySnapshot;
    } catch {
      display = {
        threadName: row.thread_name,
        description: "",
        createdAt: row.created_at,
      };
    }
    return {
      approvalId: row.id,
      backendApprovalId: row.backend_approval_id,
      projectId: row.project_id,
      threadId: row.thread_id,
      threadName: row.thread_name,
      turnId: row.turn_id,
      callId: row.call_id,
      approvalType: row.approval_type,
      status: row.status,
      actorId: row.actor_id || undefined,
      decision: row.decision ? row.decision as ApprovalDecision["action"] : undefined,
      statusReason: row.status_reason || undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at ?? undefined,
      expiredAt: row.expired_at ?? undefined,
      display,
    };
  }
}
