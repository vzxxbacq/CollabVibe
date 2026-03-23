import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UnifiedAgentEvent } from "../../../packages/agent-core/src/index";
import type { PlatformOutput } from "../../event/output-contracts";
import { EventPipeline } from "../../event/pipeline";
import { AgentEventRouter } from "../../event/router";

class TestSource {
  private handler: ((event: UnifiedAgentEvent) => void) | undefined;

  onNotification(handler: (event: UnifiedAgentEvent) => void): void {
    this.handler = handler;
  }

  emit(event: UnifiedAgentEvent): void {
    if (!this.handler) {
      throw new Error("missing notification handler");
    }
    this.handler(event);
  }
}

describe("EventPipeline streaming aggregation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("aggregates high-frequency content deltas before routing", async () => {
    const outputs: PlatformOutput[] = [];
    const syncTurnState = vi.fn(async () => undefined);
    const pipeline = new EventPipeline(
      new AgentEventRouter(async (_projectId, output) => {
        outputs.push(output);
      }),
      {
        registerApprovalRequest: () => ({ accepted: true }),
        finishTurn: async () => null,
        syncTurnState,
        finalizeTurnState: async () => undefined,
      },
      {
        streamOutput: {
          persistWindowMs: 40,
          persistMaxWaitMs: 200,
          uiWindowMs: 40,
          uiMaxWaitMs: 200,
        }
      }
    );

    const source = new TestSource();
    pipeline.attachSource(source, {
      projectId: "p1",
      threadName: "main",
      threadId: "thread-1",
    });
    pipeline.activateTurn({
      projectId: "p1",
      threadName: "main",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    source.emit({ type: "content_delta", turnId: "turn-1", delta: "hello " } as UnifiedAgentEvent);
    source.emit({ type: "content_delta", turnId: "turn-1", delta: "world" } as UnifiedAgentEvent);

    await vi.advanceTimersByTimeAsync(60);

    expect(syncTurnState).toHaveBeenCalledTimes(1);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({
      kind: "content",
      data: { kind: "content", turnId: "turn-1", delta: "hello world" }
    });
  });

  it("force flushes pending streaming state before terminal summary", async () => {
    const outputs: PlatformOutput[] = [];
    const syncTurnState = vi.fn(async () => undefined);
    const finalizeTurnState = vi.fn(async () => undefined);
    const pipeline = new EventPipeline(
      new AgentEventRouter(async (_projectId, output) => {
        outputs.push(output as any);
      }),
      {
        registerApprovalRequest: () => ({ accepted: true }),
        finishTurn: async () => null,
        syncTurnState,
        finalizeTurnState,
      },
      {
        streamOutput: {
          persistWindowMs: 1000,
          persistMaxWaitMs: 5000,
          uiWindowMs: 1000,
          uiMaxWaitMs: 5000,
        }
      }
    );

    const source = new TestSource();
    pipeline.attachSource(source, {
      projectId: "p1",
      threadName: "main",
      threadId: "thread-1",
    });
    pipeline.activateTurn({
      projectId: "p1",
      threadName: "main",
      threadId: "thread-1",
      turnId: "turn-2",
    });

    source.emit({ type: "content_delta", turnId: "turn-2", delta: "pending tail" } as UnifiedAgentEvent);
    source.emit({ type: "turn_complete", turnId: "turn-2", lastAgentMessage: "pending tail" } as UnifiedAgentEvent);

    await vi.runAllTimersAsync();

    expect(syncTurnState).toHaveBeenCalled();
    expect(finalizeTurnState).toHaveBeenCalledTimes(1);
    expect(outputs.map((output) => output.kind)).toEqual(["content", "notification", "turn_summary"]);
    expect((outputs[0] as any).data).toMatchObject({ kind: "content", delta: "pending tail" });
  });
});
