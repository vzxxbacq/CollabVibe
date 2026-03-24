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
  ): Promise<"applied" | "duplicate" | "expired" | "missing" | "rejected" | "bridge_duplicate"> {
    if (!signatureValid) {
      return "rejected";
    }
    const existing = await this.store.getById(decision.approvalId);
    if (!existing) {
      return "missing";
    }
    if (existing.status === "expired") {
      return "expired";
    }
    if (existing.status !== "pending") {
      return "duplicate";
    }
    const dedupKey = buildApprovalDedupKey(decision);
    if (isDuplicateApproval(this.seenApprovalIds.has(dedupKey), this.inFlightApprovalIds.has(dedupKey))) {
      return "duplicate";
    }
    this.inFlightApprovalIds.add(dedupKey);
    try {
      // Pass the stable system approvalId into the bridge; the bridge resolves the backend handle.
      const bridgeResult = await this.bridge.applyDecision(decision.approvalId, decision.action);
      if (bridgeResult !== "duplicate") {
        await this.store.markResolved(decision);
      }
      this.seenApprovalIds.add(dedupKey);
      return mapBridgeDecisionResult(bridgeResult);
    } finally {
      this.inFlightApprovalIds.delete(dedupKey);
    }
  }
}
