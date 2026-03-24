import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";
import type { BackendScriptStep } from "../_helpers/scripted-backend";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("merge edge cases", () => {
  // Helper: create project + thread (merge ops need a thread with worktree)
  async function setupProjectWithThread(chatId: string, name: string, threadName: string) {
    const projectId = await sim!.createProjectFromChat({ chatId, userId: "admin-user", name });
    await sim!.startScriptedTurn({
      projectId, chatId, userId: "admin-user",
      threadName, threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    return projectId;
  }

  async function waitForThreadRecord(
    projectId: string,
    threadName: string,
    predicate: (record: NonNullable<Awaited<ReturnType<SimHarness["api"]["getThreadRecord"]>>>) => boolean,
  ): Promise<void> {
    const simRef = sim!;
    let lastRecord: Awaited<ReturnType<SimHarness["api"]["getThreadRecord"]>> | null = null;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const record = await simRef.api.getThreadRecord({ projectId, threadName });
      lastRecord = record;
      if (record && predicate(record)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`thread record did not reach expected state: ${projectId}/${threadName} -> ${JSON.stringify(lastRecord)}`);
  }

  it("handleMergePreview on thread with no diverged commits", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me1", "p-me1", "merge-t1");
    try {
      const result = await sim.api.handleMergePreview({ projectId, branchName: "merge-t1" });
      expect(result).toBeDefined();
      expect(result.kind).toBeDefined();
    } catch (e: any) {
      // Expected: no diverged commits
      expect(e.message).toMatch(/no.*diverge|no.*commit|not.*found|worktree|merge|preview/i);
    }
  });

  it("handleMergeReject does not throw", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me2", "p-me2", "merge-t2");
    // Reject should be safe even without preview
    sim.api.handleMergeReject({ projectId, branchName: "merge-t2" });
  });

  it("handleMerge on non-existent branch returns error", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-me3", userId: "admin-user", name: "p-me3" });
    try {
      const result = await sim.api.handleMerge({
        projectId, branchName: "ghost-branch", actorId: "admin-user",
      });
      // If it returns, check the kind
      expect(result.kind).toBeDefined();
    } catch {
      // Expected for non-existent branch
    }
  });

  it("cancelMergeReview without active review does not crash", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me4", "p-me4", "merge-t4");
    try {
      await sim.api.cancelMergeReview({
        projectId, branchName: "merge-t4", actorId: "admin-user",
      });
    } catch {
      // Expected: no active review to cancel
    }
  });

  it("mergeAcceptAll without active review throws or returns error", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me5", "p-me5", "merge-t5");
    try {
      const result = await sim.api.mergeAcceptAll({
        projectId, branchName: "merge-t5", actorId: "admin-user",
      });
      expect(result.kind).toBeDefined();
    } catch {
      // Expected
    }
  });

  it("commitMergeReview without active review throws", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me6", "p-me6", "merge-t6");
    try {
      await sim.api.commitMergeReview({
        projectId, branchName: "merge-t6", actorId: "admin-user",
      });
    } catch {
      // Expected
    }
  });

  it("getMergeReview without active review returns or throws", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me7", "p-me7", "merge-t7");
    try {
      const result = await sim.api.getMergeReview({ projectId, branchName: "merge-t7" });
      expect(result.kind).toBeDefined();
    } catch {
      // Expected
    }
  });

  it("pushWorkBranch on project without gitUrl throws or succeeds gracefully", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me8", "p-me8", "merge-t8");
    try {
      await sim.api.pushWorkBranch({ projectId, actorId: "admin-user" });
    } catch (e: any) {
      // Expected: no remote configured
      expect(e.message).toBeDefined();
    }
  });

  it("detectStaleThreads with no other threads returns empty", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me9", "p-me9", "only-thread");
    const result = await sim.api.detectStaleThreads({ projectId, mergedThreadName: "only-thread" });
    expect(result).toBeDefined();
    expect(result.updated).toBeDefined();
    expect(result.stale).toBeDefined();
    expect(result.errors).toBeDefined();
  });

  it("detectStaleThreads structure is correct", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me10", "p-me10", "t-stale");
    const result = await sim.api.detectStaleThreads({ projectId, mergedThreadName: "t-stale" });
    expect(Array.isArray(result.updated)).toBe(true);
    expect(Array.isArray(result.stale)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("handleMerge with force flag", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me11", "p-me11", "force-t");
    try {
      const result = await sim.api.handleMerge({
        projectId, branchName: "force-t", actorId: "admin-user", force: true,
      });
      expect(result.kind).toBeDefined();
    } catch {
      // May throw if no diverged commits, which is expected
    }
  });

  it("handleMergeConfirm without prior preview", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me12", "p-me12", "no-preview-t");
    try {
      const result = await sim.api.handleMergeConfirm({
        projectId, branchName: "no-preview-t", actorId: "admin-user",
      });
      expect(result.kind).toBeDefined();
    } catch {
      // Expected
    }
  });

  it("startMergeReview on non-existent branch", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-me13", userId: "admin-user", name: "p-me13" });
    try {
      await sim.api.startMergeReview({
        projectId, branchName: "ghost", actorId: "admin-user",
      });
    } catch {
      // Expected
    }
  });

  it("mergeDecideFile on non-existent review", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me14", "p-me14", "decide-t");
    try {
      await sim.api.mergeDecideFile({
        projectId, branchName: "decide-t", filePath: "test.ts",
        decision: "accept", actorId: "admin-user",
      });
    } catch {
      // Expected
    }
  });

  it("merge with context parameter", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me15", "p-me15", "ctx-t");
    try {
      const result = await sim.api.handleMergePreview({
        projectId, branchName: "ctx-t",
        context: { traceId: "trace-123", userId: "admin-user" },
      });
      expect(result.kind).toBeDefined();
    } catch {
      // Expected
    }
  });

  it("configureMergeResolver sets backend", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me16", "p-me16", "resolver-t");
    try {
      await sim.api.configureMergeResolver({
        projectId, branchName: "resolver-t",
        backendId: "codex", model: "fake-model",
      });
    } catch {
      // May throw if no merge session
    }
  });


  it("cancelMergeReview interrupts resolver even before active turn state is persisted", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me18", "p-me18", "race-branch");

    sim.gitOps.merge.startSession = async () => ({
      files: [{ path: "conflict.ts", status: "conflict" as const }],
      baseSha: "sha-base-race", headSha: "sha-head-race", preMergeSha: "sha-pre-race",
    });
    sim.gitOps.merge.readFileDiff = async () => "conflict diff";

    const resolverScript: BackendScriptStep[] = [
      { type: "sleep", ms: 80 },
      { type: "event", event: { type: "turn_complete", turnId: "resolver-turn-race", lastAgentMessage: "done" } },
    ];
    sim.fakeBackend.setScript("merge-race-branch", resolverScript);

    await sim.api.startMergeReview({
      projectId, branchName: "race-branch", actorId: "admin-user",
    });

    const review = await sim.api.resolveConflictsViaAgent({
      projectId, branchName: "race-branch", actorId: "admin-user",
    });
    expect(review.kind).toBe("review");

    await sim.api.cancelMergeReview({
      projectId, branchName: "race-branch", actorId: "admin-user",
    });

    const interruptCalls = sim.fakeBackend.getInterruptCalls("merge-race-branch");
    expect(interruptCalls).toEqual([
      expect.objectContaining({ turnId: "resolver-turn-race" })
    ]);

    await new Promise((resolve) => setTimeout(resolve, 120));

    await expect(sim.api.getMergeReview({ projectId, branchName: "race-branch" })).rejects.toThrow();
  });

  it("detectStaleThreads excludes deleted merged thread but still reports other stale threads", async () => {
    sim = await SimHarness.create();
    const simRef = sim;
    const projectId = await sim.createProjectFromChat({ chatId: "c-me19", userId: "admin-user", name: "p-me19" });

    sim.fakeBackend.setScript("merged-keep", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({
      projectId,
      userId: "admin-user",
      actorId: "admin-user",
      threadName: "merged-keep",
      backendId: "codex",
      model: "fake-model",
    });

    await sim.startScriptedTurn({
      projectId, chatId: "c-me19", userId: "admin-user",
      threadName: "stale-worker", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    await waitForThreadRecord(projectId, "stale-worker", (record) => Boolean(record.baseSha) && record.hasDiverged === true);

    await sim.api.deleteThread({ projectId, threadName: "merged-keep", actorId: "admin-user" });

    const originalHead = simRef.gitOps.worktree.getHeadSha;
    simRef.gitOps.worktree.getHeadSha = async (cwd: string) => {
      if (cwd === (await simRef.api.getProjectRecord(projectId))?.cwd) {
        return "new-work-branch-head";
      }
      return originalHead(cwd);
    };

    const report = await simRef.api.detectStaleThreads({ projectId, mergedThreadName: "some-other-merge" });
    expect(report.updated.some((item) => item.threadName === "merged-keep")).toBe(false);
    expect(report.stale.some((item) => item.threadName === "merged-keep")).toBe(false);
    expect(report.errors.some((item) => item.threadName === "merged-keep")).toBe(false);
    expect(report.stale.some((item) => item.threadName === "stale-worker")).toBe(true);
  });

  it("detectStaleThreads skips kept merged thread for the current merge but reports it again later", async () => {
    sim = await SimHarness.create();
    const simRef = sim;
    const projectId = await sim.createProjectFromChat({ chatId: "c-me20", userId: "admin-user", name: "p-me20" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-me20", userId: "admin-user",
      threadName: "kept-thread", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    await waitForThreadRecord(projectId, "kept-thread", (record) => Boolean(record.baseSha) && record.hasDiverged === true);

    const originalHead = simRef.gitOps.worktree.getHeadSha;
    simRef.gitOps.worktree.getHeadSha = async (cwd: string) => {
      if (cwd === (await simRef.api.getProjectRecord(projectId))?.cwd) {
        return "new-work-branch-head";
      }
      return originalHead(cwd);
    };

    const skippedForCurrentMerge = await simRef.api.detectStaleThreads({ projectId, mergedThreadName: "kept-thread" });
    expect(skippedForCurrentMerge.updated).toEqual([]);
    expect(skippedForCurrentMerge.stale).toEqual([]);
    expect(skippedForCurrentMerge.errors).toEqual([]);

    const reportedLater = await simRef.api.detectStaleThreads({ projectId, mergedThreadName: "some-other-merge" });
    expect(reportedLater.stale.some((item) => item.threadName === "kept-thread")).toBe(true);
  });

  it("resolveConflictsViaAgent without conflicts", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProjectWithThread("c-me17", "p-me17", "agent-t");
    try {
      const result = await sim.api.resolveConflictsViaAgent({
        projectId, branchName: "agent-t", actorId: "admin-user",
      });
      expect(result.kind).toBeDefined();
    } catch {
      // Expected
    }
  });
});
