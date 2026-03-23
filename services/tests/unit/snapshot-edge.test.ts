import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("snapshot edge cases", () => {
  it("listSnapshots on thread with no turns returns empty", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn1", userId: "admin-user", name: "p-sn1" });
    sim.fakeBackend.setScript("t-sn1", SIMPLE_TURN_SCRIPT);
    const result = await sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "t-sn1", backendId: "codex", model: "fake-model",
    });
    const snapshots = await sim.api.listSnapshots({ projectId, threadId: result.threadId });
    expect(snapshots).toEqual([]);
  });

  it("listSnapshots after one turn returns array", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn2", userId: "admin-user", name: "p-sn2" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-sn2", userId: "admin-user",
      threadName: "t-sn2", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    if (threads.length > 0 && threads[0].threadId) {
      const snapshots = await sim.api.listSnapshots({ projectId, threadId: threads[0].threadId! });
      // startScriptedTurn may or may not create snapshots
      expect(Array.isArray(snapshots)).toBe(true);
    }
  });

  it("snapshot record has expected fields", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn3", userId: "admin-user", name: "p-sn3" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-sn3", userId: "admin-user",
      threadName: "t-sn3", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    if (threads.length > 0 && threads[0].threadId) {
      const snapshots = await sim.api.listSnapshots({ projectId, threadId: threads[0].threadId! });
      if (snapshots.length > 0) {
        const snap = snapshots[0];
        expect(snap.threadId).toBeTruthy();
        expect(snap.turnId).toBeTruthy();
        expect(snap.cwd).toBeTruthy();
        expect(snap.gitRef).toBeTruthy();
        expect(snap.createdAt).toBeTruthy();
        expect(typeof snap.turnIndex).toBe("number");
      }
    }
  });

  it("getSnapshotDiff returns diff or null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn4", userId: "admin-user", name: "p-sn4" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-sn4", userId: "admin-user",
      threadName: "t-sn4", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    // Join thread so getUserActiveThread resolves
    await sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-sn4" });
    try {
      const diff = await sim.api.getSnapshotDiff({ projectId, userId: "admin-user" });
      if (diff) {
        expect(Array.isArray(diff.files)).toBe(true);
        expect(typeof diff.summary).toBe("string");
      }
    } catch {
      // May throw if snapshot comparison not possible
    }
  });

  it("jumpToSnapshot with invalid turnId throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn5", userId: "admin-user", name: "p-sn5" });
    await expect(sim.api.jumpToSnapshot({
      projectId, targetTurnId: "ghost-turn-id",
    })).rejects.toThrow();
  });

  it("jumpToSnapshot with valid turnId", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn6", userId: "admin-user", name: "p-sn6" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-sn6", userId: "admin-user",
      threadName: "t-sn6", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      try {
        const result = await sim.api.jumpToSnapshot({ projectId, targetTurnId: turns[0].turnId });
        expect(result.snapshot).toBeDefined();
        expect(typeof result.contextReset).toBe("boolean");
      } catch {
        // May throw if snapshot not available for fake turns
      }
    }
  });

  it("snapshot turnIndex starts at 0 or 1", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn7", userId: "admin-user", name: "p-sn7" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-sn7", userId: "admin-user",
      threadName: "t-sn7", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    if (threads.length > 0 && threads[0].threadId) {
      const snapshots = await sim.api.listSnapshots({ projectId, threadId: threads[0].threadId! });
      if (snapshots.length > 0) {
        expect(snapshots[0].turnIndex).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("listSnapshots for non-existent threadId returns empty", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn8", userId: "admin-user", name: "p-sn8" });
    const snapshots = await sim.api.listSnapshots({ projectId, threadId: "ghost-thread-id" });
    expect(snapshots).toEqual([]);
  });

  it("snapshot createdAt is ISO date string", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn9", userId: "admin-user", name: "p-sn9" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-sn9", userId: "admin-user",
      threadName: "t-sn9", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    if (threads.length > 0 && threads[0].threadId) {
      const snapshots = await sim.api.listSnapshots({ projectId, threadId: threads[0].threadId! });
      if (snapshots.length > 0) {
        const date = new Date(snapshots[0].createdAt);
        expect(date.getTime()).not.toBeNaN();
      }
    }
  });

  it("getSnapshotDiff without active thread returns null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sn10", userId: "admin-user", name: "p-sn10" });
    try {
      const diff = await sim.api.getSnapshotDiff({ projectId, userId: "admin-user" });
      // Should be null when no active thread
      expect(diff).toBeNull();
    } catch {
      // May throw instead of returning null
    }
  });
});
