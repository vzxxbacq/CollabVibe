import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TurnStateSnapshot } from "../../turn/turn-state";
import { StreamOutputCoordinator } from "../../event/stream-output-coordinator";

function createSnapshot(turnId: string): TurnStateSnapshot {
  return {
    threadId: "thread-1",
    turnId,
    threadName: "main",
    content: "",
    reasoning: "",
    planDraft: "",
    tools: [],
    toolOutputs: [],
    duration: 0,
  };
}

describe("StreamOutputCoordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("aggregates streaming messages for persist and ui flush", async () => {
    const syncTurnState = vi.fn(async () => undefined);
    const routeMessage = vi.fn(async () => undefined);
    const coordinator = new StreamOutputCoordinator(
      { syncTurnState, routeMessage },
      { persistWindowMs: 50, persistMaxWaitMs: 200, uiWindowMs: 50, uiMaxWaitMs: 200 }
    );

    await coordinator.ingest("p1", "main", "turn-1", createSnapshot("turn-1"), {
      kind: "content",
      turnId: "turn-1",
      delta: "hello "
    });
    await coordinator.ingest("p1", "main", "turn-1", createSnapshot("turn-1"), {
      kind: "content",
      turnId: "turn-1",
      delta: "world"
    });

    expect(syncTurnState).not.toHaveBeenCalled();
    expect(routeMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60);

    expect(syncTurnState).toHaveBeenCalledTimes(1);
    expect(routeMessage).toHaveBeenCalledTimes(1);
    expect(routeMessage).toHaveBeenCalledWith("p1", {
      kind: "content",
      turnId: "turn-1",
      delta: "hello world"
    });
  });

  it("forceFlush flushes pending output immediately", async () => {
    const syncTurnState = vi.fn(async () => undefined);
    const routeMessage = vi.fn(async () => undefined);
    const coordinator = new StreamOutputCoordinator(
      { syncTurnState, routeMessage },
      { persistWindowMs: 1000, persistMaxWaitMs: 5000, uiWindowMs: 1000, uiMaxWaitMs: 5000 }
    );

    await coordinator.ingest("p1", "main", "turn-2", createSnapshot("turn-2"), {
      kind: "tool_output",
      turnId: "turn-2",
      callId: "call-1",
      delta: "line-1\n",
      source: "stdout"
    });

    await coordinator.forceFlush("p1", "main", "turn-2", "test");

    expect(syncTurnState).toHaveBeenCalledTimes(1);
    expect(routeMessage).toHaveBeenCalledTimes(1);
    expect(routeMessage).toHaveBeenCalledWith("p1", {
      kind: "tool_output",
      turnId: "turn-2",
      callId: "call-1",
      delta: "line-1\n",
      source: "stdout"
    });
  });
});
