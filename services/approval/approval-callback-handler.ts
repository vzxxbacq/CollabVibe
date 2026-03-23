import type { ApprovalDecision, ApprovalDecisionBridge, ApprovalDecisionStore } from "./contracts";
export type { ApprovalDecision, ApprovalDecisionBridge, ApprovalDecisionStore } from "./contracts";
import { buildApprovalDedupKey } from "./approval-dedup";
import { isDuplicateApproval, mapBridgeDecisionResult } from "./approval-result-policy";

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
    const dedupKey = buildApprovalDedupKey(decision);
    if (isDuplicateApproval(this.seenApprovalIds.has(dedupKey), this.inFlightApprovalIds.has(dedupKey))) {
      return "duplicate";
    }
    this.inFlightApprovalIds.add(dedupKey);
    try {
      await this.store.save(decision);
      // Pass raw approvalId to backend — the backend expects the original id, not the composite key
      const bridgeResult = await this.bridge.applyDecision(decision.approvalId, decision.action);
      this.seenApprovalIds.add(dedupKey);
      return mapBridgeDecisionResult(bridgeResult);
    } finally {
      this.inFlightApprovalIds.delete(dedupKey);
    }
  }
}
