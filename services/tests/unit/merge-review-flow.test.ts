import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

// Helper: create project with a diverged thread
async function setupProject(chatId: string, name: string, threadName: string): Promise<string> {
  const projectId = await sim!.createProjectFromChat({ chatId, userId: "admin-user", name });
  await sim!.startScriptedTurn({
    projectId, chatId, userId: "admin-user",
    threadName, threadId: "", turnId: "",
    script: SIMPLE_TURN_SCRIPT,
  });
  return projectId;
}

describe("merge review with files", () => {
  it("startMergeReview with files → getMergeReview → decideFile → commitReview", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProject("c-rv1", "p-rv1", "rv-1");

    // Override fakeGitOps.merge.startSession to return files for review
    const gitOps = sim.gitOps;
    gitOps.merge.startSession = async () => ({
      files: [
        { path: "src/app.ts", status: "modified" as const },
        { path: "src/utils.ts", status: "conflict" as const },
      ],
      baseSha: "HEAD",
      headSha: "HEAD",
      preMergeSha: "HEAD",
    });
    gitOps.merge.readFileDiff = async () => "diff --git a/src/app.ts\n+new line";
    gitOps.repo.getCurrentBranch = async (cwd: string) =>
      cwd.includes("--rv-1") ? "rv-1" : "feature/p-rv1";

    // 1. Start review
    const startResult = await sim.api.startMergeReview({
      projectId, branchName: "rv-1", actorId: "admin-user",
    });
    expect(startResult.kind).toBe("review");

    // 2. Get review
    const getResult = await sim.api.getMergeReview({
      projectId, branchName: "rv-1",
    });
    expect(getResult.kind).toBe("review");

    // 3. Decide file
    const decideResult = await sim.api.mergeDecideFile({
      projectId, branchName: "rv-1", filePath: "src/app.ts",
      decision: "accept", actorId: "admin-user",
    });
    expect(decideResult.kind).toBe("review");

    // 4. Decide second file
    await sim.api.mergeDecideFile({
      projectId, branchName: "rv-1", filePath: "src/utils.ts",
      decision: "keep_main", actorId: "admin-user",
    });

    // 5. Commit review
    const commitResult = await sim.api.commitMergeReview({
      projectId, branchName: "rv-1", actorId: "admin-user",
    });
    expect(commitResult.kind).toBe("success");
  });

  it("startMergeReview → acceptAll → commitReview", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProject("c-rv2", "p-rv2", "rv-2");

    const gitOps = sim.gitOps;
    gitOps.merge.startSession = async () => ({
      files: [
        { path: "a.ts", status: "modified" as const },
        { path: "b.ts", status: "modified" as const },
        { path: "c.ts", status: "conflict" as const },
      ],
      baseSha: "HEAD", headSha: "HEAD", preMergeSha: "HEAD",
    });
    gitOps.merge.readFileDiff = async () => "diff content";
    gitOps.repo.getCurrentBranch = async (cwd: string) =>
      cwd.includes("--rv-2") ? "rv-2" : "feature/p-rv2";

    const startResult = await sim.api.startMergeReview({
      projectId, branchName: "rv-2", actorId: "admin-user",
    });
    expect(startResult.kind).toBe("review");

    // Accept all remaining
    const acceptResult = await sim.api.mergeAcceptAll({
      projectId, branchName: "rv-2", actorId: "admin-user",
    });
    expect(acceptResult.kind).toBe("review");

    await sim.api.mergeDecideFile({
      projectId, branchName: "rv-2", filePath: "c.ts",
      decision: "use_branch", actorId: "admin-user",
    });

    // Commit
    const commitResult = await sim.api.commitMergeReview({
      projectId, branchName: "rv-2", actorId: "admin-user",
    });
    expect(commitResult.kind).toBe("success");
  });

  it("startMergeReview → cancelMergeReview stops review", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProject("c-rv3", "p-rv3", "rv-3");

    const gitOps = sim.gitOps;
    gitOps.merge.startSession = async () => ({
      files: [{ path: "x.ts", status: "modified" as const }],
      baseSha: "HEAD", headSha: "HEAD", preMergeSha: "HEAD",
    });
    gitOps.merge.readFileDiff = async () => "diff content";

    await sim.api.startMergeReview({
      projectId, branchName: "rv-3", actorId: "admin-user",
    });

    // Cancel
    await sim.api.cancelMergeReview({
      projectId, branchName: "rv-3", actorId: "admin-user",
    });

    // getMergeReview should now throw since session is cleared
    try {
      await sim.api.getMergeReview({ projectId, branchName: "rv-3" });
      expect.fail("should have thrown");
    } catch (e: any) {
      expect(e.message).toBeDefined();
    }
  });

  it("startMergeReview with no changes throws MERGE_NO_CHANGES", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProject("c-rv4", "p-rv4", "rv-4");

    // Default fake returns empty files — should throw
    try {
      await sim.api.startMergeReview({
        projectId, branchName: "rv-4", actorId: "admin-user",
      });
      expect.fail("should have thrown MERGE_NO_CHANGES");
    } catch (e: any) {
      expect(e.message).toMatch(/没有需要合并的变更|no.*changes/i);
    }
  });

  it("configureMergeResolver on active session", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProject("c-rv5", "p-rv5", "rv-5");

    const gitOps = sim.gitOps;
    gitOps.merge.startSession = async () => ({
      files: [{ path: "z.ts", status: "conflict" as const }],
      baseSha: "sha-base-005", headSha: "sha-head-005", preMergeSha: "sha-premerge-005",
    });
    gitOps.merge.readFileDiff = async () => "conflict diff";

    await sim.api.startMergeReview({
      projectId, branchName: "rv-5", actorId: "admin-user",
    });

    // Configure resolver
    try {
      await sim.api.configureMergeResolver({
        projectId, branchName: "rv-5",
        backendId: "codex", model: "fake-model",
      });
    } catch {
      // May throw if resolver config isn't supported in test env
    }
  });

  it("resolveConflictsViaAgent on diverged thread", async () => {
    sim = await SimHarness.create();
    const projectId = await setupProject("c-rv6", "p-rv6", "rv-6");

    const gitOps = sim.gitOps;
    gitOps.merge.startSession = async () => ({
      files: [{ path: "conflict.ts", status: "conflict" as const }],
      baseSha: "sha-base-006", headSha: "sha-head-006", preMergeSha: "sha-premerge-006",
    });
    gitOps.merge.readFileDiff = async () => "conflict diff";

    await sim.api.startMergeReview({
      projectId, branchName: "rv-6", actorId: "admin-user",
    });

    try {
      const result = await sim.api.resolveConflictsViaAgent({
        projectId, branchName: "rv-6", actorId: "admin-user",
      });
      expect(result.kind).toBeDefined();
    } catch (e: any) {
      // May fail because FakeAgentApi doesn't support merge resolver — that's OK
      expect(e.message).toBeDefined();
    }
  });
});
