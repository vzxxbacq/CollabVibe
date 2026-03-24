import type { PendingApprovalContext } from "../approval/approval-types";

/**
 * TurnStateManager — transient per-process runtime state only.
 *
 * Persistent turn truth lives in TurnRecord / ThreadTurnState repositories.
 * This manager only stores approval wait contexts keyed by approvalId.
 */
export class TurnStateManager {
  private readonly retentionMs: number;
  private readonly pendingApprovals = new Map<string, PendingApprovalContext>();
  private readonly cleanupTimers = new Map<string, NodeJS.Timeout>();

  constructor(retentionMs = 5 * 60 * 1000) {
    this.retentionMs = retentionMs;
  }

  setPendingApproval(approvalId: string, ctx: PendingApprovalContext): void {
    this.clearCleanupTimer(approvalId);
    this.pendingApprovals.set(approvalId, ctx);
  }

  getPendingApproval(approvalId: string): PendingApprovalContext | undefined {
    return this.pendingApprovals.get(approvalId);
  }

  clearPendingApproval(approvalId: string): boolean {
    this.clearCleanupTimer(approvalId);
    return this.pendingApprovals.delete(approvalId);
  }

  markApprovalResolved(approvalId: string, resolution: "approve" | "deny" | "approve_always", resolvedAt = new Date().toISOString()): PendingApprovalContext | undefined {
    const existing = this.pendingApprovals.get(approvalId);
    if (!existing) return undefined;
    const updated: PendingApprovalContext = { ...existing, resolution, resolvedAt };
    this.pendingApprovals.set(approvalId, updated);
    this.clearCleanupTimer(approvalId);
    const timer = setTimeout(() => {
      this.cleanupTimers.delete(approvalId);
      this.pendingApprovals.delete(approvalId);
    }, this.retentionMs);
    this.cleanupTimers.set(approvalId, timer);
    return updated;
  }

  clearPendingApprovalsForTurn(projectThreadKey: string, turnId: string): string[] {
    const removed: string[] = [];
    for (const [approvalId, ctx] of this.pendingApprovals.entries()) {
      if (ctx.projectThreadKey === projectThreadKey && ctx.turnId === turnId) {
        this.clearCleanupTimer(approvalId);
        this.pendingApprovals.delete(approvalId);
        removed.push(approvalId);
      }
    }
    return removed;
  }

  hasPendingApprovalForThread(projectThreadKey: string): boolean {
    for (const ctx of this.pendingApprovals.values()) {
      if (ctx.projectThreadKey === projectThreadKey && !ctx.resolution) {
        return true;
      }
    }
    return false;
  }

  private clearCleanupTimer(approvalId: string): void {
    const timer = this.cleanupTimers.get(approvalId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(approvalId);
    }
  }
}
