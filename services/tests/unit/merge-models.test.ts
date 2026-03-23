import { describe, expect, it } from "vitest";

import { fromPersistedMergeSessionRecord, toPersistedMergeSessionRecord } from "../../merge/merge-session-codec";
import { availableDecisionsForStatus, buildFileReview, buildMergeSummary, firstPendingIndex } from "../../merge/merge-review-model";
import type { MergeSession } from "../../merge/merge-session-model";

function sampleSession(): MergeSession {
  return {
    projectId: "p1",
    chatId: "c1",
    branchName: "feature/x",
    baseBranch: "main",
    mainCwd: "/repo",
    worktreeCwd: "/repo/.worktrees/x",
    preMergeSha: "abc",
    currentIndex: 0,
    state: "reviewing",
    createdAt: 1,
    files: [
      { path: "a.ts", status: "conflict", diff: "@@", decision: "pending", agentAttempts: 0 },
      { path: "b.ts", status: "auto_merged", diff: "@@", decision: "accept", agentAttempts: 0 },
      { path: "c.ts", status: "added", diff: "@@", decision: "skip", agentAttempts: 0 },
    ],
    resolverBackendId: "codex",
    resolverModel: "fake-model",
  };
}

describe("merge session codec", () => {
  it("round-trips persisted session record", () => {
    const persisted = toPersistedMergeSessionRecord(sampleSession());
    const restored = fromPersistedMergeSessionRecord(persisted);
    expect(restored).toEqual(expect.objectContaining({
      projectId: "p1",
      chatId: "c1",
      branchName: "feature/x",
      files: expect.any(Array),
    }));
  });
});

describe("merge review model", () => {
  it("returns available decisions for status", () => {
    expect(availableDecisionsForStatus("conflict")).toEqual(["keep_main", "use_branch"]);
    expect(availableDecisionsForStatus("added")).toEqual(["accept", "skip"]);
  });

  it("builds file review projection", () => {
    const review = buildFileReview(sampleSession());
    expect(review.file.path).toBe("a.ts");
    expect(review.overview.pendingConflicts).toBe(1);
    expect(review.progress.accepted).toBe(1);
  });

  it("finds first pending index and summary", () => {
    expect(firstPendingIndex(sampleSession())).toBe(0);
    const summary = buildMergeSummary(sampleSession());
    expect(summary.files).toEqual([
      { path: "a.ts", decision: "skip", status: "conflict" },
      { path: "b.ts", decision: "accept", status: "auto_merged" },
      { path: "c.ts", decision: "skip", status: "added" },
    ]);
    expect(summary.hasPartialMerge).toBe(true);
  });
});
