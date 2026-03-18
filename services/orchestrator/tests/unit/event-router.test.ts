import { describe, expect, it, vi } from "vitest";

import { AgentEventRouter } from "../../src/event/router";

function makeAdapter() {
  return {
    appendContent: vi.fn(async () => undefined),
    appendReasoning: vi.fn(async () => undefined),
    appendPlan: vi.fn(async () => undefined),
    appendToolOutput: vi.fn(async () => undefined),
    updateProgress: vi.fn(async () => undefined),
    requestApproval: vi.fn(async () => undefined),
    requestUserInput: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
    completeTurn: vi.fn(async () => undefined),
    sendFileReview: vi.fn(async () => undefined),
    sendMergeSummary: vi.fn(async () => undefined),
    sendThreadOperation: vi.fn(async () => undefined),
    sendSnapshotOperation: vi.fn(async () => undefined)
  };
}

describe("event-router", () => {
  it("throws clear error when route is missing", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    await expect(
      router.routeEvent("chat-1", "thread-a", {
        type: "agent_message_content_delta",
        delta: "hello"
      })
    ).rejects.toThrowError("missing route for chat-1/thread-a");
  });

  it("routes multi-thread events to the correct chat adapter calls", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    router.registerRoute("chat-1", {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-a",
      turnId: "turn-a"
    });
    router.registerRoute("chat-1", {
      chatId: "chat-1",
      threadName: "thread-b",
      threadId: "thr-b",
      turnId: "turn-b"
    });

    await router.routeEvent("chat-1", "thread-a", {
      type: "agent_message_content_delta",
      delta: "hello-a"
    });
    await router.routeEvent("chat-1", "thread-b", {
      type: "exec_approval_request",
      call_id: "call-b",
      turn_id: "turn-b",
      command: ["npm", "test"]
    });

    expect(adapter.appendContent).toHaveBeenCalledWith(
      "chat-1",
      "turn-a",
      "hello-a"
    );
    expect(adapter.requestApproval).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        turnId: "turn-b",
        callId: "call-b"
      })
    );
  });
});
