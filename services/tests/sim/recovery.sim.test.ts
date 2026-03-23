import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("recovery sim", () => {
  it("thread created before turn is visible in listThreads", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-thr-recov", userId: "admin-user", name: "p-thr-recov" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-thr-recov", userId: "admin-user",
      threadName: "recov-thread", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads.some((t: any) => t.threadName === "recov-thread")).toBe(true);
  });
});
