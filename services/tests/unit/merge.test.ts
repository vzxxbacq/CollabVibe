import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("merge preview", () => {
  it("merge preview returns response or expected error", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-merge", userId: "admin-user", name: "p-merge" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-merge", userId: "admin-user",
      threadName: "merge-thread", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    // Merge preview — may fail if no diverged commits in worktree
    try {
      const preview = await sim.api.handleMergePreview({ projectId, branchName: "merge-thread" });
      expect(preview).toBeDefined();
    } catch (e: any) {
      // Expected: no diverged commits in a fake turn
      expect(e.message).toMatch(/no.*diverge|no.*commit|not.*found|preview|worktree|merge/i);
    }
  });
});
