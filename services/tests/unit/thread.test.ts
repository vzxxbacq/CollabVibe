import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("thread management", () => {
  it("create thread and list it", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-thr", userId: "admin-user", name: "p-thr" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-thr", userId: "admin-user",
      threadName: "thread-a", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads).toEqual(expect.arrayContaining([
      expect.objectContaining({ threadName: "thread-a" }),
    ]));
  });

  it("multiple threads coexist", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-multi-thr", userId: "admin-user", name: "p-multi-thr" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-multi-thr", userId: "admin-user",
      threadName: "thread-1", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    sim.fakeBackend.setScript("thread-2", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "thread-2", backendId: "codex", model: "fake-model",
    });

    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    const threadNames = threads.map((t: any) => t.threadName);
    expect(threadNames).toContain("thread-1");
    expect(threadNames).toContain("thread-2");
  });

  it("join and leave thread", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-join", userId: "admin-user", name: "p-join" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-join", userId: "admin-user",
      threadName: "thread-join", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    sim.api.addAdmin("user-joiner");
    await sim.api.joinThread({ projectId, userId: "user-joiner", actorId: "user-joiner", threadName: "thread-join" });

    const active = await sim.api.getUserActiveThread({ projectId, userId: "user-joiner" });
    expect(active).toEqual(expect.objectContaining({ threadName: "thread-join" }));

    await sim.api.leaveThread({ projectId, userId: "user-joiner", actorId: "user-joiner" });
    const afterLeave = await sim.api.getUserActiveThread({ projectId, userId: "user-joiner" });
    expect(afterLeave).toBeNull();
  });
});
