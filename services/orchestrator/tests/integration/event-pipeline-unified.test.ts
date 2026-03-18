import { describe, expect, it, vi } from "vitest";

import { AgentEventRouter } from "../../src/event/router";
import { EventPipeline } from "../../src/event/pipeline";

class UnifiedSource {
  private handler: ((event: { type: string;[key: string]: unknown }) => void) | null = null;

  onNotification(handler: (event: { type: string;[key: string]: unknown }) => void): void {
    this.handler = handler;
  }

  emit(event: { type: string;[key: string]: unknown }): void {
    this.handler?.(event);
  }
}

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

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function bindTurn(pipeline: EventPipeline, source: UnifiedSource, route: {
  chatId: string;
  userId?: string;
  threadName: string;
  threadId: string;
  turnId: string;
}): void {
  pipeline.attachSource(source as never, route);
  pipeline.activateTurn(route);
}

describe("event-pipeline unified", () => {
  it("accepts unified events directly", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new UnifiedSource();

    bindTurn(pipeline, source as never, {
      chatId: "chat-1",
      userId: "u-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "content_delta", delta: "hello" });
    source.emit({ type: "turn_complete", lastAgentMessage: "done" });
    await flush();

    expect(adapter.appendContent).toHaveBeenCalledWith("chat-1", "turn-1", "hello");
    expect(adapter.completeTurn).toHaveBeenCalledWith("chat-1", expect.objectContaining({
      kind: "turn_summary",
      lastAgentMessage: "done"
    }));
    expect(orchestrator.finishTurn).toHaveBeenCalledWith("chat-1", "thr-1", expect.any(Object));
  });
});
