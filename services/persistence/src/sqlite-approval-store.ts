import type { DatabaseSync } from "node:sqlite";

import type { ApprovalDecision, ApprovalDecisionStore } from "../../approval/src/contracts";

interface ApprovalRow {
  id: string;
  decision: string;
  actor_id: string;
}

export class SqliteApprovalStore implements ApprovalDecisionStore {
  constructor(private readonly db: DatabaseSync) {}

  private requireApprovalField<T>(value: T | null | undefined, field: string): T {
    if (value === null || value === undefined || value === "") {
      throw new Error(`ApprovalDecision.${field} is required`);
    }
    return value;
  }

  async save(decision: ApprovalDecision): Promise<void> {
    const compositeId = `${this.requireApprovalField(decision.threadId, "threadId")}:${decision.approvalId}`;
    this.db
      .prepare(
        `INSERT INTO approvals (id, project_id, thread_id, turn_id, approval_type, decision, actor_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id)
         DO UPDATE SET
           decision = excluded.decision,
           actor_id = excluded.actor_id`
      )
      .run(
        compositeId,
        this.requireApprovalField(decision.projectId, "projectId"),
        decision.threadId,
        this.requireApprovalField(decision.turnId, "turnId"),
        this.requireApprovalField(decision.approvalType, "approvalType"),
        decision.action,
        decision.approverId,
        new Date().toISOString()
      );
  }

  async getById(approvalId: string): Promise<ApprovalRow | null> {
    const row = this.db
      .prepare("SELECT id, decision, actor_id FROM approvals WHERE id = ?")
      .get(approvalId) as ApprovalRow | undefined;
    return row ?? null;
  }
}
