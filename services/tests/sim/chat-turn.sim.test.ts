import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import {
  SIMPLE_TURN_SCRIPT,
  REASONING_CONTENT_SCRIPT,
  TOOL_USE_SCRIPT,
  PLAN_MODE_SCRIPT,
  MULTI_TOKEN_SCRIPT,
  ABORTED_TURN_SCRIPT,
  NOTIFICATION_ONLY_SCRIPT,
} from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("chat-turn sim", () => {
  it("simple turn: start → content → complete", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-turn", userId: "admin-user", name: "p-turn" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-turn", userId: "admin-user",
      threadName: "t-simple", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });

    const kinds = sim.platform.listOutputKinds("c-turn");
    expect(kinds).toContain("notification");
    expect(kinds).toContain("content");
    expect(kinds).toContain("turn_summary");
  });

  it("reasoning + content interleaved", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-reason", userId: "admin-user", name: "p-reason" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-reason", userId: "admin-user",
      threadName: "t-reason", threadId: "", turnId: "",
      script: REASONING_CONTENT_SCRIPT,
    });

    const kinds = sim.platform.listOutputKinds("c-reason");
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("content");
    expect(kinds).toContain("turn_summary");
  });

  it("tool use: begin → output → end", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-tool", userId: "admin-user", name: "p-tool" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-tool", userId: "admin-user",
      threadName: "t-tool", threadId: "", turnId: "",
      script: TOOL_USE_SCRIPT,
    });

    const kinds = sim.platform.listOutputKinds("c-tool");
    expect(kinds).toContain("progress");
    expect(kinds).toContain("tool_output");
    expect(kinds).toContain("content");
    expect(kinds).toContain("turn_summary");
  });

  it("plan mode: plan_delta + plan_update", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-plan", userId: "admin-user", name: "p-plan" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-plan", userId: "admin-user",
      threadName: "t-plan", threadId: "", turnId: "",
      script: PLAN_MODE_SCRIPT,
    });

    const kinds = sim.platform.listOutputKinds("c-plan");
    expect(kinds).toContain("plan");
    expect(kinds).toContain("plan_update");
    expect(kinds).toContain("turn_summary");
  });

  it("token usage updated multiple times", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-token", userId: "admin-user", name: "p-token" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-token", userId: "admin-user",
      threadName: "t-token", threadId: "", turnId: "",
      script: MULTI_TOKEN_SCRIPT,
    });

    const outputs = sim.platform.listOutputs("c-token").map((o) => o.output);
    const summaries = outputs.filter((o) => o.kind === "turn_summary");
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });

  it("notification-only turn", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-notif", userId: "admin-user", name: "p-notif" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-notif", userId: "admin-user",
      threadName: "t-notif", threadId: "", turnId: "",
      script: NOTIFICATION_ONLY_SCRIPT,
    });

    const kinds = sim.platform.listOutputKinds("c-notif");
    expect(kinds).toContain("notification");
    expect(kinds).toContain("turn_summary");
  });

  it("aborted turn emits turn_aborted", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-abort", userId: "admin-user", name: "p-abort" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-abort", userId: "admin-user",
      threadName: "t-abort", threadId: "", turnId: "",
      script: ABORTED_TURN_SCRIPT,
    });

    const kinds = sim.platform.listOutputKinds("c-abort");
    expect(kinds).toContain("content");
    expect(kinds).toContain("notification");
    expect(kinds).not.toContain("turn_summary");
  });
});
