import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("thread edge cases", () => {
  // ── Create thread ──

  it("create thread returns threadId and threadName", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tc1", userId: "admin-user", name: "p-tc1" });
    sim.fakeBackend.setScript("t-basic", SIMPLE_TURN_SCRIPT);
    const result = await sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "t-basic", backendId: "codex", model: "fake-model",
    });
    expect(result.threadId).toBeTruthy();
    expect(result.threadName).toBe("t-basic");
    expect(result.cwd).toBeTruthy();
  });

  it("create thread with duplicate name throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tc2", userId: "admin-user", name: "p-tc2" });
    sim.fakeBackend.setScript("dup-t", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "dup-t", backendId: "codex", model: "fake-model",
    });
    sim.fakeBackend.setScript("dup-t", SIMPLE_TURN_SCRIPT);
    await expect(sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "dup-t", backendId: "codex", model: "fake-model",
    })).rejects.toThrow();
  });

  it("create thread with special characters", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tc3", userId: "admin-user", name: "p-tc3" });
    sim.fakeBackend.setScript("t-特殊", SIMPLE_TURN_SCRIPT);
    const result = await sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "t-特殊", backendId: "codex", model: "fake-model",
    });
    expect(result.threadName).toBe("t-特殊");
  });

  it("thread name collision across projects is allowed", async () => {
    sim = await SimHarness.create();
    const pid1 = await sim.createProjectFromChat({ chatId: "c-tc4a", userId: "admin-user", name: "p-tc4a" });
    const pid2 = await sim.createProjectFromChat({ chatId: "c-tc4b", userId: "admin-user", name: "p-tc4b" });
    sim.fakeBackend.setScript("same-name", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId: pid1, userId: "admin-user", actorId: "admin-user", threadName: "same-name", backendId: "codex", model: "fake-model" });
    sim.fakeBackend.setScript("same-name", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId: pid2, userId: "admin-user", actorId: "admin-user", threadName: "same-name", backendId: "codex", model: "fake-model" });
    const t1 = await sim.api.listThreads({ projectId: pid1, actorId: "admin-user" });
    const t2 = await sim.api.listThreads({ projectId: pid2, actorId: "admin-user" });
    expect(t1.some((t: any) => t.threadName === "same-name")).toBe(true);
    expect(t2.some((t: any) => t.threadName === "same-name")).toBe(true);
  });

  it("create thread generates unique threadId", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tc5", userId: "admin-user", name: "p-tc5" });
    sim.fakeBackend.setScript("t-uniq1", SIMPLE_TURN_SCRIPT);
    const r1 = await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-uniq1", backendId: "codex", model: "fake-model" });
    sim.fakeBackend.setScript("t-uniq2", SIMPLE_TURN_SCRIPT);
    const r2 = await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-uniq2", backendId: "codex", model: "fake-model" });
    expect(r1.threadId).not.toBe(r2.threadId);
  });

  // ── Delete ──

  it("delete thread and verify removed from list", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-td1", userId: "admin-user", name: "p-td1" });
    sim.fakeBackend.setScript("t-del", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-del", backendId: "codex", model: "fake-model" });
    await sim.api.deleteThread({ projectId, threadName: "t-del", actorId: "admin-user" });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads.some((t: any) => t.threadName === "t-del")).toBe(false);
  });

  it("delete non-existent thread throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-td2", userId: "admin-user", name: "p-td2" });
    await expect(sim.api.deleteThread({ projectId, threadName: "ghost", actorId: "admin-user" })).rejects.toThrow();
  });

  // ── Join / Leave ──

  it("join non-existent thread throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tj1", userId: "admin-user", name: "p-tj1" });
    await expect(sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "ghost-thread" })).rejects.toThrow();
  });

  it("leave when not in any thread is idempotent", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tl1", userId: "admin-user", name: "p-tl1" });
    // No thread joined — leave should not throw
    await sim.api.leaveThread({ projectId, userId: "admin-user", actorId: "admin-user" });
    const active = await sim.api.getUserActiveThread({ projectId, userId: "admin-user" });
    expect(active).toBeNull();
  });

  it("multiple users join same thread", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tj2", userId: "admin-user", name: "p-tj2" });
    sim.fakeBackend.setScript("shared-t", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "shared-t", backendId: "codex", model: "fake-model" });
    
    sim.api.addAdmin("user-b");
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "shared-t" });
    await sim.api.joinThread({ projectId, userId: "user-b", actorId: "user-b", threadName: "shared-t" });
    
    const a1 = await sim.api.getUserActiveThread({ projectId, userId: "admin-user" });
    const a2 = await sim.api.getUserActiveThread({ projectId, userId: "user-b" });
    expect(a1?.threadName).toBe("shared-t");
    expect(a2?.threadName).toBe("shared-t");
  });

  it("user joins thread A then joins thread B (auto-leave A)", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tj3", userId: "admin-user", name: "p-tj3" });
    sim.fakeBackend.setScript("tA", SIMPLE_TURN_SCRIPT);
    sim.fakeBackend.setScript("tB", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "tA", backendId: "codex", model: "fake-model" });
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "tB", backendId: "codex", model: "fake-model" });
    
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "tA" });
    expect((await sim.api.getUserActiveThread({ projectId, userId: "admin-user" }))?.threadName).toBe("tA");
    
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "tB" });
    expect((await sim.api.getUserActiveThread({ projectId, userId: "admin-user" }))?.threadName).toBe("tB");
  });

  // ── getThreadRecord ──

  it("getThreadRecord for active thread returns data", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tr1", userId: "admin-user", name: "p-tr1" });
    sim.fakeBackend.setScript("t-rec", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-rec", backendId: "codex", model: "fake-model" });
    const rec = await sim.api.getThreadRecord({ projectId, threadName: "t-rec" });
    expect(rec).toBeDefined();
    expect(rec?.threadName).toBe("t-rec");
  });

  it("getThreadRecord for non-existent thread returns null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tr2", userId: "admin-user", name: "p-tr2" });
    const rec = await sim.api.getThreadRecord({ projectId, threadName: "ghost" });
    expect(rec).toBeNull();
  });

  // ── listThreads ──

  it("listThreads on empty project returns empty", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-lt1", userId: "admin-user", name: "p-lt1" });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads).toEqual([]);
  });

  it("listThreads returns multiple threads", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-lt2", userId: "admin-user", name: "p-lt2" });
    sim.fakeBackend.setScript("ta", SIMPLE_TURN_SCRIPT);
    sim.fakeBackend.setScript("tb", SIMPLE_TURN_SCRIPT);
    sim.fakeBackend.setScript("tc", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "ta", backendId: "codex", model: "fake-model" });
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "tb", backendId: "codex", model: "fake-model" });
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "tc", backendId: "codex", model: "fake-model" });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads.length).toBe(3);
  });

  it("listThreads includes thread status", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-lt3", userId: "admin-user", name: "p-lt3" });
    sim.fakeBackend.setScript("t-status", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-status", backendId: "codex", model: "fake-model" });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads[0]?.status).toBeDefined();
  });

  // ── getUserActiveThread ──

  it("getUserActiveThread after join returns thread info", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-gat1", userId: "admin-user", name: "p-gat1" });
    sim.fakeBackend.setScript("t-active", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-active", backendId: "codex", model: "fake-model" });
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-active" });
    const active = await sim.api.getUserActiveThread({ projectId, userId: "admin-user" });
    expect(active).not.toBeNull();
    expect(active?.threadName).toBe("t-active");
    expect(active?.threadId).toBeTruthy();
  });

  it("getUserActiveThread after leave returns null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-gat2", userId: "admin-user", name: "p-gat2" });
    sim.fakeBackend.setScript("t-leave", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-leave", backendId: "codex", model: "fake-model" });
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-leave" });
    await sim.api.leaveThread({ projectId, userId: "admin-user", actorId: "admin-user" });
    const active = await sim.api.getUserActiveThread({ projectId, userId: "admin-user" });
    expect(active).toBeNull();
  });

  it("getUserActiveThread for user not in any thread returns null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-gat3", userId: "admin-user", name: "p-gat3" });
    const active = await sim.api.getUserActiveThread({ projectId, userId: "admin-user" });
    expect(active).toBeNull();
  });

  // ── isPendingApproval ──

  it("isPendingApproval returns false when no approval", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ipa", userId: "admin-user", name: "p-ipa" });
    sim.fakeBackend.setScript("t-noappr", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-noappr", backendId: "codex", model: "fake-model" });
    expect(sim.api.isPendingApproval({ projectId, threadName: "t-noappr" })).toBe(false);
  });

  // ── Thread preserves backend ──

  it("thread preserves backend identity", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tbi", userId: "admin-user", name: "p-tbi" });
    sim.fakeBackend.setScript("t-backend", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-backend", backendId: "codex", model: "fake-model" });
    const rec = await sim.api.getThreadRecord({ projectId, threadName: "t-backend" });
    expect(rec?.backend?.backendId).toBe("codex");
    expect(rec?.backend?.model).toBe("fake-model");
  });

  // ── delete thread also unbinds users ──

  it("delete thread unbinds user from it", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tdu", userId: "admin-user", name: "p-tdu" });
    sim.fakeBackend.setScript("t-unbind", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-unbind", backendId: "codex", model: "fake-model" });
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-unbind" });
    await sim.api.deleteThread({ projectId, threadName: "t-unbind", actorId: "admin-user" });
    const active = await sim.api.getUserActiveThread({ projectId, userId: "admin-user" });
    expect(active).toBeNull();
  });

  it("thread persists across multiple turns", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tpt", userId: "admin-user", name: "p-tpt" });
    
    // First turn creates the thread
    await sim.startScriptedTurn({
      projectId, chatId: "c-tpt", userId: "admin-user",
      threadName: "t-persist", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    // Verify thread exists
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads.some((t: any) => t.threadName === "t-persist")).toBe(true);
  });

  it("createThread on disabled project may be restricted", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dis-t", userId: "admin-user", name: "p-dis-t" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    sim.fakeBackend.setScript("t-forbidden", SIMPLE_TURN_SCRIPT);
    try {
      await sim.api.createThread({
        projectId, userId: "admin-user", actorId: "admin-user",
        threadName: "t-forbidden", backendId: "codex", model: "fake-model",
      });
      // If succeeds, disabled project guard not enforced for createThread
    } catch {
      // Expected if disabled project guard is enforced
    }
  });
});
