import { afterEach, describe, expect, it } from "vitest";

import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("stream throttling simulation", () => {
  it("coalesces burst content and tool output before terminal delivery", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "chat-stream-1", userId: "admin-user", name: "proj-stream-1" });

    await sim.startScriptedTurn({
      projectId,
      chatId: "chat-stream-1",
      userId: "user-1",
      threadName: "main",
      threadId: "thread-stream-1",
      turnId: "turn-stream-1",
      script: [
        { type: "event", event: { type: "turn_started", turnId: "turn-stream-1", title: "started" } },
        { type: "event", event: { type: "content_delta", turnId: "turn-stream-1", delta: "hello " } },
        { type: "event", event: { type: "content_delta", turnId: "turn-stream-1", delta: "stream " } },
        { type: "event", event: { type: "content_delta", turnId: "turn-stream-1", delta: "world" } },
        { type: "event", event: { type: "tool_begin", turnId: "turn-stream-1", tool: "exec_command", label: "cat log", callId: "call-stream-1" } },
        { type: "event", event: { type: "tool_output", turnId: "turn-stream-1", callId: "call-stream-1", delta: "line-1\n", source: "stdout" } },
        { type: "event", event: { type: "tool_output", turnId: "turn-stream-1", callId: "call-stream-1", delta: "line-2\n", source: "stdout" } },
        { type: "event", event: { type: "tool_output", turnId: "turn-stream-1", callId: "call-stream-1", delta: "line-3\n", source: "stdout" } },
        { type: "event", event: { type: "turn_complete", turnId: "turn-stream-1", lastAgentMessage: "hello stream world" } },
      ],
    });

    const outputs = sim.platform.listOutputs("chat-stream-1").map((item) => item.output);
    const contentOutputs = outputs.filter((output) => output.kind === "content");
    const toolOutputs = outputs.filter((output) => output.kind === "tool_output");

    expect(contentOutputs).toHaveLength(1);
    expect((contentOutputs[0] as any).data.delta).toBe("hello stream world");

    expect(toolOutputs).toHaveLength(1);
    expect((toolOutputs[0] as any).data.delta).toBe("line-1\nline-2\nline-3\n");
    expect(outputs.some((output) => output.kind === "turn_summary")).toBe(true);
  });

  it("flushes pending plan delta before critical plan_update", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "chat-stream-2", userId: "admin-user", name: "proj-stream-2" });

    await sim.startScriptedTurn({
      projectId,
      chatId: "chat-stream-2",
      userId: "user-2",
      threadName: "main",
      threadId: "thread-stream-2",
      turnId: "turn-stream-2",
      script: [
        { type: "event", event: { type: "turn_started", turnId: "turn-stream-2", title: "planning" } },
        { type: "event", event: { type: "plan_delta", turnId: "turn-stream-2", delta: "step 1; " } },
        { type: "event", event: { type: "plan_delta", turnId: "turn-stream-2", delta: "step 2; " } },
        { type: "event", event: { type: "plan_delta", turnId: "turn-stream-2", delta: "step 3" } },
        { type: "event", event: { type: "plan_update", turnId: "turn-stream-2", explanation: "final plan", plan: [
          { step: "analyze", status: "completed" },
          { step: "implement", status: "in_progress" }
        ] } },
        { type: "event", event: { type: "turn_complete", turnId: "turn-stream-2", lastAgentMessage: "plan ready" } },
      ],
    });

    const outputs = sim.platform.listOutputs("chat-stream-2").map((item) => item.output);
    const kinds = outputs.map((output) => output.kind);
    const planOutputs = outputs.filter((output) => output.kind === "plan");
    const planUpdateOutputs = outputs.filter((output) => output.kind === "plan_update");

    expect(planOutputs).toHaveLength(1);
    expect((planOutputs[0] as any).data.delta).toBe("step 1; step 2; step 3");
    expect(planUpdateOutputs).toHaveLength(1);
    expect(kinds.indexOf("plan")).toBeLessThan(kinds.indexOf("plan_update"));
  });
});
