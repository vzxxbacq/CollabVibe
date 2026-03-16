import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApprovalWaitManager } from "../../../src/session/state-machine";

describe("approval-wait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("handles timeout callback for pending approvals", () => {
    const timedOut: string[] = [];
    const manager = new ApprovalWaitManager({ timeoutMs: 500 });
    manager.waitFor("appr-1", (approvalId) => timedOut.push(approvalId));

    vi.advanceTimersByTime(500);
    expect(timedOut).toEqual(["appr-1"]);
  });

  it("handles duplicate and invalid approval decisions", () => {
    const manager = new ApprovalWaitManager({ timeoutMs: 1_000 });
    manager.waitFor("appr-2", () => undefined);

    expect(manager.decide("appr-2")).toEqual({ status: "resolved" });
    expect(manager.decide("appr-2")).toEqual({ status: "duplicate" });
    expect(() => manager.decide("appr-404")).toThrowError("invalid approval id: appr-404");
  });
});
