import type { PendingApprovalContext } from "../orchestrator-context";

/**
 * TurnStateManager — transient per-process runtime state only.
 *
 * Persistent turn truth lives in TurnRecord / ThreadTurnState repositories.
 * This manager only stores approval wait contexts keyed by approvalId.
 */
export class TurnStateManager {
  private readonly pendingApprovals = new Map<string, PendingApprovalContext>();

  setPendingApproval(approvalId: string, ctx: PendingApprovalContext): void {
    this.pendingApprovals.set(approvalId, ctx);
  }

  getPendingApproval(approvalId: string): PendingApprovalContext | undefined {
    return this.pendingApprovals.get(approvalId);
  }

  clearPendingApproval(approvalId: string): boolean {
    return this.pendingApprovals.delete(approvalId);
  }
}
