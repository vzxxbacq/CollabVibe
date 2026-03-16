import type { ApprovalDecision, ApprovalDecisionBridge, ApprovalDecisionStore } from "./contracts";
export type { ApprovalDecision, ApprovalDecisionBridge, ApprovalDecisionStore } from "./contracts";

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
    if (this.seenApprovalIds.has(decision.approvalId) || this.inFlightApprovalIds.has(decision.approvalId)) {
      return "duplicate";
    }
    this.inFlightApprovalIds.add(decision.approvalId);
    try {
      await this.store.save(decision);
      const bridgeResult = await this.bridge.applyDecision(decision.approvalId, decision.action);
      this.seenApprovalIds.add(decision.approvalId);
      if (bridgeResult === "duplicate") {
        return "bridge_duplicate";
      }
      return "applied";
    } finally {
      this.inFlightApprovalIds.delete(decision.approvalId);
    }
  }
}
