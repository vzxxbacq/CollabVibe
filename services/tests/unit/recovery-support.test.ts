import { describe, expect, it } from "vitest";

import { classifyRecoveryFailure } from "../../session/recovery-classifier";
import {
  applyMergeRecoveryResult,
  createEmptyRecoverySummary,
  recordThreadRecoveryFailure,
  recordThreadRecoverySuccess,
} from "../../session/recovery-summary";

describe("recovery classifier", () => {
  it("classifies tagged known errors", () => {
    expect(classifyRecoveryFailure(new Error("CONFIG_ERROR: missing project"))).toEqual({
      category: "CONFIG_ERROR",
      reason: "missing project",
    });
  });

  it("falls back to UNKNOWN", () => {
    expect(classifyRecoveryFailure(new Error("plain message"))).toEqual({
      category: "UNKNOWN",
      reason: "plain message",
    });
    expect(classifyRecoveryFailure(new Error("WEIRD_TAG: msg"))).toEqual({
      category: "UNKNOWN",
      reason: "WEIRD_TAG: msg",
    });
  });
});

describe("recovery summary", () => {
  it("records success and failures", () => {
    let summary = createEmptyRecoverySummary();
    summary = recordThreadRecoverySuccess(summary);
    summary = recordThreadRecoveryFailure(summary, {
      projectId: "p1",
      threadName: "t1",
      category: "UNKNOWN",
      reason: "boom",
    });

    expect(summary.recovered).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.failures).toHaveLength(1);
  });

  it("applies merge recovery results", () => {
    const summary = applyMergeRecoveryResult(createEmptyRecoverySummary(), {
      recovered: 2,
      failed: 1,
      failures: [{ projectId: "p1", branchName: "b1", reason: "conflict" }],
    });
    expect(summary.recovered).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.mergeFailures).toHaveLength(1);
  });
});
