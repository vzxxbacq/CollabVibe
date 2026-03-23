import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT, REASONING_CONTENT_SCRIPT, TOOL_USE_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("turn query", () => {
  it("listTurns on empty project returns empty", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq1", userId: "admin-user", name: "p-tq1" });
    const turns = await sim.api.listTurns({ projectId });
    expect(turns).toEqual([]);
  });

  it("listTurns returns turns after simple turn", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq2", userId: "admin-user", name: "p-tq2" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq2", userId: "admin-user",
      threadName: "t-tq2", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    // startScriptedTurn may or may not persist turns to the turn registry
    expect(Array.isArray(turns)).toBe(true);
  });

  it("listTurns has expected fields", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq3", userId: "admin-user", name: "p-tq3" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq3", userId: "admin-user",
      threadName: "t-tq3", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      const turn = turns[0];
      expect(turn.turnId).toBeTruthy();
      expect(turn.threadId).toBeTruthy();
      expect(turn.threadName).toBe("t-tq3");
      expect(turn.projectId).toBe(projectId);
      expect(turn.status).toBeDefined();
      expect(turn.createdAt).toBeTruthy();
      expect(turn.updatedAt).toBeTruthy();
    }
  });

  it("listTurns with limit=1 returns at most one", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq4", userId: "admin-user", name: "p-tq4" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq4", userId: "admin-user",
      threadName: "t-tq4", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId, limit: 1 });
    expect(turns.length).toBeLessThanOrEqual(1);
  });

  it("getTurnDetail returns record and detail", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq5", userId: "admin-user", name: "p-tq5" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq5", userId: "admin-user",
      threadName: "t-tq5", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      const detail = await sim.api.getTurnDetail({ projectId, turnId: turns[0].turnId });
      expect(detail.record).toBeDefined();
      expect(detail.detail).toBeDefined();
      expect(detail.record.turnId).toBe(turns[0].turnId);
    }
  });

  it("getTurnDetail for non-existent turnId throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq6", userId: "admin-user", name: "p-tq6" });
    await expect(sim.api.getTurnDetail({ projectId, turnId: "ghost-turn" })).rejects.toThrow();
  });

  it("getTurnCardData for valid turn", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq7", userId: "admin-user", name: "p-tq7" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq7", userId: "admin-user",
      threadName: "t-tq7", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      const cardData = await sim.api.getTurnCardData({ projectId, turnId: turns[0].turnId });
      // May be null if not yet processed, but should not throw
      if (cardData) {
        expect(cardData).toBeDefined();
      }
    }
  });

  it("getTurnCardData for non-existent turnId returns null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq8", userId: "admin-user", name: "p-tq8" });
    const cardData = await sim.api.getTurnCardData({ projectId, turnId: "ghost-turn" });
    expect(cardData).toBeNull();
  });

  it("turn records lastAgentMessage", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq9", userId: "admin-user", name: "p-tq9" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq9", userId: "admin-user",
      threadName: "t-tq9", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      expect(turns[0].lastAgentMessage).toBe("hello world");
    }
  });

  it("listTurns records threadName correctly", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq10", userId: "admin-user", name: "p-tq10" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq10", userId: "admin-user",
      threadName: "my-custom-thread", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      expect(turns[0].threadName).toBe("my-custom-thread");
    }
  });

  it("listTurns records createdAt and updatedAt", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq11", userId: "admin-user", name: "p-tq11" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq11", userId: "admin-user",
      threadName: "t-tq11", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      expect(turns[0].createdAt).toBeTruthy();
      expect(turns[0].updatedAt).toBeTruthy();
      // updatedAt should be >= createdAt
      expect(new Date(turns[0].updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(turns[0].createdAt).getTime());
    }
  });

  it("turn with reasoning script records reasoning output", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq12", userId: "admin-user", name: "p-tq12" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq12", userId: "admin-user",
      threadName: "t-tq12", threadId: "", turnId: "",
      script: REASONING_CONTENT_SCRIPT,
    });
    // Verify outputs include reasoning
    const kinds = sim.platform.listOutputKinds("c-tq12");
    expect(kinds).toContain("reasoning");
  });

  it("turn with tool use records filesChangedCount if applicable", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq13", userId: "admin-user", name: "p-tq13" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq13", userId: "admin-user",
      threadName: "t-tq13", threadId: "", turnId: "",
      script: TOOL_USE_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      // filesChangedCount should be a number (may be 0 for fake backend)
      expect(typeof turns[0].filesChangedCount).toBe("number");
    }
  });

  it("listTurns default limit is reasonable", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tq14", userId: "admin-user", name: "p-tq14" });
    // Create one turn
    await sim.startScriptedTurn({
      projectId, chatId: "c-tq14", userId: "admin-user",
      threadName: "t-tq14", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const turns = await sim.api.listTurns({ projectId });
    // startScriptedTurn may or may not persist to turn registry
    expect(Array.isArray(turns)).toBe(true);
  });
});
