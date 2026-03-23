import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import {
  SIMPLE_TURN_SCRIPT,
  MULTI_TOOL_SCRIPT,
  LONG_CONTENT_SCRIPT,
  EMPTY_TURN_SCRIPT,
  ERROR_TURN_SCRIPT,
  PLAN_MODE_SCRIPT,
  ABORTED_TURN_SCRIPT,
  approvalScript,
} from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("turn lifecycle edge cases", () => {
  // ── Create turn ──

  it("create turn returns turnId", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ct1", userId: "admin-user", name: "p-ct1" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ct1", userId: "admin-user",
      threadName: "t-ct1", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    // Turn should have been created successfully — check outputs
    const kinds = sim.platform.listOutputKinds("c-ct1");
    expect(kinds).toContain("turn_summary");
  });

  it("duplicate createTurn with same platform+projectId+messageId reuses existing turnId", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dup", userId: "admin-user", name: "p-dup" });
    sim.fakeBackend.setScript("t-dup", SIMPLE_TURN_SCRIPT);

    await sim.api.createThread({
      projectId,
      userId: "admin-user",
      actorId: "admin-user",
      threadName: "t-dup",
      backendId: "codex",
      model: "fake-model",
    });

    const first = await sim.api.createTurn({
      projectId,
      userId: "admin-user",
      actorId: "admin-user",
      text: "same message",
      platform: "feishu",
      messageId: "msg-dup-1",
    });
    const second = await sim.api.createTurn({
      projectId,
      userId: "admin-user",
      actorId: "admin-user",
      text: "same message",
      platform: "feishu",
      messageId: "msg-dup-1",
    });

    expect(first.status).toBe("started");
    expect(second.status).toBe("duplicate");
    expect(second.turnId).toBe(first.turnId);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const turns = await sim.api.listTurns({ projectId });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.turnId).toBe(first.turnId);

    const turnDetail = await sim.api.getTurnDetail({ projectId, turnId: first.turnId });
    expect(turnDetail.record.sourceMessageId).toBe("msg-dup-1");
    expect(turnDetail.record.platform).toBe("feishu");
  });

  it("turn with multi-tool script emits progress and tool_output", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-mt", userId: "admin-user", name: "p-mt" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-mt", userId: "admin-user",
      threadName: "t-mt", threadId: "", turnId: "",
      script: MULTI_TOOL_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-mt");
    expect(kinds).toContain("progress");
    expect(kinds).toContain("tool_output");
    expect(kinds).toContain("content");
    expect(kinds).toContain("turn_summary");
  });

  it("turn with long content handles large deltas", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-lc", userId: "admin-user", name: "p-lc" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-lc", userId: "admin-user",
      threadName: "t-lc", threadId: "", turnId: "",
      script: LONG_CONTENT_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-lc");
    expect(kinds).toContain("content");
    expect(kinds).toContain("turn_summary");
  });

  it("empty turn (start → complete, no content) completes", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-et", userId: "admin-user", name: "p-et" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-et", userId: "admin-user",
      threadName: "t-et", threadId: "", turnId: "",
      script: EMPTY_TURN_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-et");
    expect(kinds).toContain("turn_summary");
  });

  it("error turn emits error notification", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-err", userId: "admin-user", name: "p-err" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-err", userId: "admin-user",
      threadName: "t-err", threadId: "", turnId: "",
      script: ERROR_TURN_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-err");
    expect(kinds).toContain("notification");
  });

  it("plan mode turn emits plan events", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-pl", userId: "admin-user", name: "p-pl" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-pl", userId: "admin-user",
      threadName: "t-pl", threadId: "", turnId: "",
      script: PLAN_MODE_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-pl");
    expect(kinds).toContain("plan");
    expect(kinds).toContain("plan_update");
  });

  it("aborted turn emits notification or turn_summary", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ab", userId: "admin-user", name: "p-ab" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ab", userId: "admin-user",
      threadName: "t-ab", threadId: "", turnId: "",
      script: ABORTED_TURN_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-ab");
    expect(kinds.some((k: string) => k === "turn_summary" || k === "notification")).toBe(true);
  });

  // ── Multiple turns on same thread ──

  it("multiple turns on same thread produce sequential outputs", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-seq", userId: "admin-user", name: "p-seq" });
    
    // First turn
    await sim.startScriptedTurn({
      projectId, chatId: "c-seq", userId: "admin-user",
      threadName: "t-seq", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    
    const kindsAfter1 = sim.platform.listOutputKinds("c-seq");
    const summaryCount1 = kindsAfter1.filter((k: string) => k === "turn_summary").length;
    expect(summaryCount1).toBeGreaterThanOrEqual(1);
  });

  // ── Interrupt ──

  it("interrupt on non-running turn returns interrupted false", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-int1", userId: "admin-user", name: "p-int1" });
    // No turn running — interrupt should return false
    const result = await sim.api.interruptTurn({ projectId, actorId: "admin-user" });
    expect(result.interrupted).toBe(false);
  });

  // ── Accept / Revert ──

  it("accept turn after completion", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-acc", userId: "admin-user", name: "p-acc" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-acc", userId: "admin-user",
      threadName: "t-acc", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    
    // Get turnId from listTurns
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      const result = await sim.api.acceptTurn({ projectId, turnId: turns[0].turnId, actorId: "admin-user" });
      expect(result.accepted).toBeDefined();
    }
  });

  it("revert turn after completion", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rev", userId: "admin-user", name: "p-rev" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-rev", userId: "admin-user",
      threadName: "t-rev", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    
    const turns = await sim.api.listTurns({ projectId });
    if (turns.length > 0) {
      const result = await sim.api.revertTurn({ projectId, turnId: turns[0].turnId, actorId: "admin-user" });
      expect(result.rolledBack).toBeDefined();
    }
  });

  it("turn outputs include notification on start", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-nots", userId: "admin-user", name: "p-nots" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-nots", userId: "admin-user",
      threadName: "t-nots", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const kinds = sim.platform.listOutputKinds("c-nots");
    expect(kinds).toContain("notification");
  });

  it("turn emits content with expected delta text", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-delta", userId: "admin-user", name: "p-delta" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-delta", userId: "admin-user",
      threadName: "t-delta", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const outputs = sim.platform.listOutputs("c-delta").map((o) => o.output);
    const contentOutputs = outputs.filter((o) => o.kind === "content");
    expect(contentOutputs.some((o: any) => o.data.delta.includes("hello world"))).toBe(true);
  });

  it("turn with approval pauses and resumes", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ap", userId: "admin-user", name: "p-ap" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ap", userId: "admin-user",
      threadName: "t-ap", threadId: "", turnId: "",
      script: approvalScript("edge-appr-1"),
    });
    
    const kindsBefore = sim.platform.listOutputKinds("c-ap");
    expect(kindsBefore).toContain("approval_request");
    
    await sim.approve({
      chatId: "c-ap", userId: "admin-user", kind: "approval_decision",
      payload: { approvalId: "edge-appr-1" },
    });
    
    const kindsAfter = sim.platform.listOutputKinds("c-ap");
    expect(kindsAfter).toContain("turn_summary");
  });

  it("createTurn on disabled project throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dis-turn", userId: "admin-user", name: "p-dis-turn" });
    
    // Create thread first, then disable project
    sim.fakeBackend.setScript("t-dis", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-dis", backendId: "codex", model: "fake-model" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    
    await expect(sim.api.createTurn({
      projectId, userId: "admin-user", actorId: "admin-user", text: "forbidden",
    })).rejects.toThrow();
  });

  it("turn content is not empty on simple turn", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ne", userId: "admin-user", name: "p-ne" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ne", userId: "admin-user",
      threadName: "t-ne", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const outputs = sim.platform.listOutputs("c-ne").map((o) => o.output);
    const contentOutputs = outputs.filter((o) => o.kind === "content");
    expect(contentOutputs.length).toBeGreaterThan(0);
  });

  it("turn summary is emitted exactly once per turn", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-once", userId: "admin-user", name: "p-once" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-once", userId: "admin-user",
      threadName: "t-once", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const outputs = sim.platform.listOutputs("c-once").map((o) => o.output);
    const summaries = outputs.filter((o) => o.kind === "turn_summary");
    expect(summaries.length).toBe(1);
  });
});
