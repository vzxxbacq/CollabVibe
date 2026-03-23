import type { ApprovalDecision, ApprovalDecisionBridge, ApprovalDecisionStore } from "./contracts";
export type { ApprovalDecision, ApprovalDecisionBridge, ApprovalDecisionStore } from "./contracts";

/**
 * Build a dedup key scoped to thread to prevent cross-thread collisions.
 * Backend approval IDs (e.g., Codex `request.id`) restart from 0 per process,
 * so using raw `approvalId` alone causes spurious duplicates across threads.
 */
function approvalDedupKey(decision: ApprovalDecision): string {
  if (!decision.threadId) {
    throw new Error(`ApprovalDecision.threadId is required for dedup: approvalId=${decision.approvalId}`);
  }
  return `${decision.threadId}:${decision.approvalId}`;
}

export class ApprovalCallbackHandler {
  private readonly seenApprovalIds = new Set<string>();

  private readonly inFlightApprovalIds = new Set<string>();

  private readonly store: ApprovalDecisionStore;

  private readonly bridge: ApprovalDecisionBridge;

  constructor(store: ApprovalDecisionStore, bridge: ApprovalDecisionBridge) {
    if (!bridge) {
      throw new Error("approval bridge is required");
    }
    this.store = store;
    this.bridge = bridge;
  }

  async handle(
    decision: ApprovalDecision,
    signatureValid: boolean
  ): Promise<"applied" | "duplicate" | "rejected" | "bridge_duplicate"> {
    if (!signatureValid) {
      return "rejected";
    }
    const dedupKey = approvalDedupKey(decision);
    if (this.seenApprovalIds.has(dedupKey) || this.inFlightApprovalIds.has(dedupKey)) {
      return "duplicate";
    }
    this.inFlightApprovalIds.add(dedupKey);
    try {
      await this.store.save(decision);
      // Pass raw approvalId to backend — the backend expects the original id, not the composite key
      const bridgeResult = await this.bridge.applyDecision(decision.approvalId, decision.action);
      this.seenApprovalIds.add(dedupKey);
      if (bridgeResult === "duplicate") {
        return "bridge_duplicate";
      }
      return "applied";
    } finally {
      this.inFlightApprovalIds.delete(dedupKey);
    }
  }
}

