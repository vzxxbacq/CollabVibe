import type { ApprovalDecision } from "./contracts";

export function buildApprovalDedupKey(decision: ApprovalDecision): string {
  if (!decision.threadId) {
    throw new Error(`ApprovalDecision.threadId is required for dedup: approvalId=${decision.approvalId}`);
  }
  return `${decision.threadId}:${decision.approvalId}`;
}
