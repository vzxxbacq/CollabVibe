import type { PendingApprovalContext } from "../approval/approval-types";

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

  clearPendingApprovalsForTurn(projectThreadKey: string, turnId: string): string[] {
    const removed: string[] = [];
    for (const [approvalId, ctx] of this.pendingApprovals.entries()) {
      if (ctx.projectThreadKey === projectThreadKey && ctx.turnId === turnId) {
        this.pendingApprovals.delete(approvalId);
        removed.push(approvalId);
      }
    }
    return removed;
  }

  hasPendingApprovalForThread(projectThreadKey: string): boolean {
    for (const ctx of this.pendingApprovals.values()) {
      if (ctx.projectThreadKey === projectThreadKey) {
        return true;
      }
    }
    return false;
  }
}
