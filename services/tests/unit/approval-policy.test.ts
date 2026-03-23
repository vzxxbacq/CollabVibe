import { describe, expect, it } from "vitest";

import { buildApprovalDedupKey } from "../../approval/approval-dedup";
import { isDuplicateApproval, mapBridgeDecisionResult } from "../../approval/approval-result-policy";

describe("approval dedup", () => {
  it("builds thread-scoped dedup key", () => {
    expect(buildApprovalDedupKey({
      approvalId: "1",
      action: "approve",
      approverId: "u1",
      threadId: "thread-a",
    })).toBe("thread-a:1");
  });

  it("requires threadId", () => {
    expect(() => buildApprovalDedupKey({
      approvalId: "1",
      action: "approve",
      approverId: "u1",
    } as any)).toThrow(/threadId is required/);
  });
});

describe("approval result policy", () => {
  it("detects duplicates", () => {
    expect(isDuplicateApproval(false, false)).toBe(false);
    expect(isDuplicateApproval(true, false)).toBe(true);
    expect(isDuplicateApproval(false, true)).toBe(true);
  });

  it("maps bridge results", () => {
    expect(mapBridgeDecisionResult("resolved")).toBe("applied");
    expect(mapBridgeDecisionResult(undefined)).toBe("applied");
    expect(mapBridgeDecisionResult("duplicate")).toBe("bridge_duplicate");
  });
});
