import { afterEach, describe, expect, it } from "vitest";

import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("platform-agnostic conversation simulation", () => {
  it("simulates a single-user chat turn from chat input to streamed outputs", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "chat-1", userId: "admin-user", name: "proj1" });

    await sim.startScriptedTurn({
      projectId,
      chatId: "chat-1",
      userId: "user-1",
      threadName: "main",
      threadId: "thread-1",
      turnId: "turn-1",
      script: [
        { type: "event", event: { type: "turn_started", turnId: "turn-1", title: "started" } },
        { type: "event", event: { type: "reasoning_delta", turnId: "turn-1", delta: "thinking" } },
        { type: "event", event: { type: "content_delta", turnId: "turn-1", delta: "hello world" } },
        { type: "event", event: { type: "tool_begin", turnId: "turn-1", tool: "exec_command", label: "ls", callId: "call-1" } },
        { type: "event", event: { type: "tool_output", turnId: "turn-1", callId: "call-1", delta: "file-a", source: "stdout" } },
        { type: "event", event: { type: "token_usage", turnId: "turn-1", input: 1, output: 2, total: 3 } },
        { type: "event", event: { type: "turn_complete", turnId: "turn-1", lastAgentMessage: "done" } },
      ],
    });

    expect(sim.platform.listOutputKinds("chat-1")).toEqual(expect.arrayContaining([
      "notification",
      "reasoning",
      "content",
      "progress",
      "tool_output",
      "turn_summary",
    ]));
  });

  it("simulates approval flow in a chat conversation", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "chat-approval", userId: "admin-user", name: "proj-approval" });

    await sim.startScriptedTurn({
      projectId,
      chatId: "chat-approval",
      userId: "user-1",
      threadName: "approval-thread",
      threadId: "thread-approval",
      turnId: "turn-approval",
      script: [
        { type: "event", event: { type: "turn_started", turnId: "turn-approval", title: "started" } },
        { type: "event", event: { type: "approval_request", turnId: "turn-approval", approvalId: "approval-1", callId: "call-approval", approvalType: "command_exec", description: "run dangerous command" } },
        { type: "wait_approval", approvalId: "approval-1" },
        { type: "event", event: { type: "content_delta", turnId: "turn-approval", delta: "continued after approval" } },
        { type: "event", event: { type: "turn_complete", turnId: "turn-approval", lastAgentMessage: "approved" } },
      ],
    });

    expect(sim.platform.listOutputKinds("chat-approval")).toContain("approval_request");
    await sim.approve({ chatId: "chat-approval", userId: "user-1", kind: "approval_decision", payload: { approvalId: "approval-1" } });

    const outputs = sim.platform.listOutputs("chat-approval").map((item) => item.output);
    expect(outputs.some((item) => item.kind === "content" && item.data.delta.includes("continued"))).toBe(true);
    expect(outputs.some((item) => item.kind === "turn_summary")).toBe(true);
  });

  it("simulates user_input request and reply in a chat conversation", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "chat-input", userId: "admin-user", name: "proj-input" });

    await sim.startScriptedTurn({
      projectId,
      chatId: "chat-input",
      userId: "user-2",
      threadName: "input-thread",
      threadId: "thread-input",
      turnId: "turn-input",
      script: [
        { type: "event", event: { type: "turn_started", turnId: "turn-input", title: "started" } },
        { type: "event", event: { type: "user_input", turnId: "turn-input", callId: "call-input", questions: [{ id: "q1", text: "choose one", options: ["A", "B"] }] } },
        { type: "wait_user_input", callId: "call-input" },
        { type: "event", event: { type: "content_delta", turnId: "turn-input", delta: "answer received" } },
        { type: "event", event: { type: "turn_complete", turnId: "turn-input", lastAgentMessage: "input done" } },
      ],
    });

    expect(sim.platform.listOutputKinds("chat-input")).toContain("user_input_request");
    await sim.replyUserInput({ chatId: "chat-input", userId: "user-2", kind: "user_input_reply", payload: { callId: "call-input", answers: { q1: ["A"] } } });

    const outputs = sim.platform.listOutputs("chat-input").map((item) => item.output);
    expect(outputs.some((item) => item.kind === "content" && item.data.delta.includes("answer received"))).toBe(true);
    expect(outputs.some((item) => item.kind === "turn_summary")).toBe(true);
  });

  it("simulates user management flows inside a chat workspace", async () => {
    sim = await SimHarness.create(["owner-1"]);
    const projectId = await sim.createProjectFromChat({ chatId: "chat-users", userId: "owner-1", name: "proj-users" });

    await sim.addAdminFromChat({ chatId: "chat-users", actorId: "owner-1", targetUserId: "ops-1" });

    expect(sim.api.isAdmin("ops-1")).toBe(true);
    expect((await sim.api.listAdmins())?.map((item) => item.userId)).toContain("ops-1");
    expect((await sim.api.listUsers())?.users.map((item) => item.userId)).toEqual(expect.arrayContaining(["ops-1", "owner-1"]));
    expect(await sim.api.listProjectMembers(projectId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "owner-1", role: "maintainer" }),
    ]));
    expect(sim.platform.listOutputs("chat-users").map((item) => item.output.kind)).toEqual(expect.arrayContaining(["notification"]));
  });

  it("simulates plugin install/remove lifecycle inside a chat workspace", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "chat-skill", userId: "admin-user", name: "proj-skill" });

    await sim.installLocalSkillFromChat({ chatId: "chat-skill", actorId: "admin-user", projectId, skillName: "demo-skill" });
    expect(await sim.api.listProjectSkills(projectId)).toEqual(expect.arrayContaining([
      expect.objectContaining({ pluginName: "demo-skill", enabled: true }),
    ]));

    await sim.removeLocalSkillFromChat({ chatId: "chat-skill", actorId: "admin-user", projectId, skillName: "demo-skill" });
    expect(await sim.api.listProjectSkills(projectId)).toEqual([]);
    expect(sim.platform.listOutputs("chat-skill").map((item) => item.output.kind)).toEqual(expect.arrayContaining(["notification"]));
  });
});
