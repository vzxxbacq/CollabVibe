import { describe, expect, it, vi } from "vitest";

import { AgentEventRouter } from "../../src/event/router";
import { EventPipeline } from "../../src/event/pipeline";
import type { CodexNotification } from "../../../../../packages/codex-client/src";
import type { UnifiedAgentEvent } from "../../../../../packages/agent-core/src/unified-agent-event";

class FakeNotificationSource {
  private handler: ((notification: CodexNotification | UnifiedAgentEvent) => void) | null = null;

  onNotification(handler: (notification: CodexNotification | UnifiedAgentEvent) => void): void {
    this.handler = handler;
  }

  emit(event: Record<string, unknown>): void {
    this.handler?.({ method: "event/msg", params: event });
  }

  emitUnified(event: Record<string, unknown>): void {
    this.handler?.(event as UnifiedAgentEvent);
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
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function bindTurn(pipeline: EventPipeline, source: FakeNotificationSource, route: {
  chatId: string;
  userId?: string;
  threadName: string;
  threadId: string;
  turnId: string;
}): void {
  pipeline.attachSource(source, route);
  pipeline.activateTurn(route);
}

describe("event-pipeline", () => {
  it("transforms and routes notifications to output adapter", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = {
      registerApprovalRequest: vi.fn(),
      finishTurn: vi.fn()
    };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({
      type: "agent_message_content_delta",
      delta: "hello"
    });
    await flush();

    expect(adapter.appendContent).toHaveBeenCalledWith(
      "chat-1",
      "turn-1",
      "hello"
    );
  });

  it("registers approval request for approval events", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = {
      registerApprovalRequest: vi.fn(),
      finishTurn: vi.fn()
    };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emitUnified({
      type: "approval_request",
      approvalId: "appr-1",
      callId: "call-1",
      turnId: "turn-1",
      approvalType: "command_exec",
      description: "npm test",
      availableActions: ["approve", "deny"]
    });
    await flush();

    expect(adapter.requestApproval).toHaveBeenCalled();
  });

  it("sends turn summary and marks turn finished on completion", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = {
      registerApprovalRequest: vi.fn(),
      finishTurn: vi.fn()
    };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({
      type: "turn_diff",
      unified_diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new"
    });
    source.emit({
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 5,
          output_tokens: 7
        }
      }
    });
    source.emit({
      type: "task_complete",
      turn_id: "turn-1",
      last_agent_message: "done"
    });
    await vi.waitFor(() => {
      expect(orchestrator.finishTurn).toHaveBeenCalledWith("chat-1", "thr-1", expect.objectContaining({ threadName: "thread-a" }));
    });

    expect(adapter.completeTurn).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        kind: "turn_summary",
        filesChanged: [],
        tokenUsage: { input: 5, output: 7 },
        lastAgentMessage: "done"
      })
    );
  });

  it("[C3-2] routes lifecycle events to adapter.updateProgress", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "exec_command_begin", command: ["npm", "test"] });
    await flush();

    expect(adapter.updateProgress).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ kind: "progress", tool: "exec_command", phase: "begin" })
    );
  });

  it("[C3-7] finishes turn on turn_aborted", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "turn_aborted", turn_id: "turn-1" });
    await vi.waitFor(() => {
      expect(orchestrator.finishTurn).toHaveBeenCalledWith("chat-1", "thr-1", expect.objectContaining({ threadName: "thread-a" }));
    });
  });

  it("[C3-8] sends turn summary on turn_aborted", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "turn_aborted", turn_id: "turn-1" });
    await flush();

    expect(adapter.completeTurn).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ kind: "turn_summary", turnId: "turn-1" })
    );
  });

  it("[C3-9] routes error and stream_error events to adapter.notify", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "error", message: "boom" });
    source.emit({ type: "stream_error", message: "stream boom" });
    await flush();

    expect(adapter.notify).toHaveBeenCalledTimes(2);
    expect(adapter.notify).toHaveBeenNthCalledWith(
      1,
      "chat-1",
      expect.objectContaining({ kind: "notification", category: "error" })
    );
    expect(adapter.notify).toHaveBeenNthCalledWith(
      2,
      "chat-1",
      expect.objectContaining({ kind: "notification", category: "error" })
    );
  });

  it("[C3-12] ignores filtered events such as session_configured", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "session_configured" });
    await flush();

    expect(adapter.appendContent).not.toHaveBeenCalled();
    expect(adapter.updateProgress).not.toHaveBeenCalled();
    expect(adapter.requestApproval).not.toHaveBeenCalled();
    expect(adapter.requestUserInput).not.toHaveBeenCalled();
    expect(adapter.notify).not.toHaveBeenCalled();
    expect(adapter.completeTurn).not.toHaveBeenCalled();
    expect(adapter.completeTurn).not.toHaveBeenCalled();
  });

  it("[C3-13] binds the same source only once", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const source = new FakeNotificationSource();

    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    bindTurn(pipeline, source, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    source.emit({ type: "agent_message_content_delta", delta: "hello" });
    await flush();

    expect(adapter.appendContent).toHaveBeenCalledTimes(1);
  });

  it("[C3-14] keeps turn contexts isolated between different turn ids", async () => {
    const adapter = makeAdapter();
    const router = new AgentEventRouter(adapter);
    const orchestrator = { registerApprovalRequest: vi.fn(), finishTurn: vi.fn() };
    const pipeline = new EventPipeline(router, orchestrator as never);
    const sourceTurn1 = new FakeNotificationSource();
    const sourceTurn2 = new FakeNotificationSource();

    bindTurn(pipeline, sourceTurn1, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-1"
    });
    bindTurn(pipeline, sourceTurn2, {
      chatId: "chat-1",
      threadName: "thread-a",
      threadId: "thr-1",
      turnId: "turn-2"
    });

    sourceTurn1.emit({
      type: "turn_diff",
      turn_id: "turn-1",
      unified_diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new"
    });
    sourceTurn2.emit({
      type: "turn_diff",
      turn_id: "turn-2",
      unified_diff: "diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n@@ -1 +1 @@\n-old\n+new"
    });
    await flush();
    sourceTurn1.emit({ type: "task_complete", turn_id: "turn-1" });
    sourceTurn2.emit({ type: "task_complete", turn_id: "turn-2" });
    await flush();

    expect(adapter.completeTurn).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ turnId: "turn-1", filesChanged: [] })
    );
    expect(adapter.completeTurn).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({ turnId: "turn-2", filesChanged: [] })
    );
  });
});
