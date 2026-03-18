/**
 * Review issue regression tests for EventPipeline and transformEvent
 * Covers: #4 (agent_message mapped to turn_complete), #8 (stale route closure),
 *         #9 (unhandled promise rejection), #13 (TurnContext memory leak)
 */
import { describe, expect, it, vi } from "vitest";

import { transformEvent } from "../../../../../packages/channel-core/src/event-transformer";
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

const ctx = {
    chatId: "chat-1",
    threadId: "thr-1",
    turnId: "turn-1"
};

describe("event-pipeline-review: regression tests for review issues", () => {
    // ──────────── Issue #4: agent_message incorrectly mapped to turn_complete ────────────

    it("[R4-1] agent_message should not map to turn_complete category", () => {
        const output = transformEvent(
            { type: "agent_message", message: "hello world" },
            ctx
        );

        expect(output).not.toBeNull();
        expect(output?.kind).toBe("notification");

        expect((output as { category?: string }).category).toBe("agent_message");
    });

    it("[R4-2] agent_message should not trigger finishTurn or completeTurn", async () => {
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
        source.emit({ type: "agent_message", message: "hello" });
        await flush();

        // agent_message should NOT trigger finishTurn
        expect(orchestrator.finishTurn).not.toHaveBeenCalled();
        // agent_message should NOT send turn summary
        expect(adapter.completeTurn).not.toHaveBeenCalled();
    });

    // ──────────── Issue #8: stale route closure on rebind ────────────

    it("[R8-1] rebinding same source to different chatId routes events to new chatId", async () => {
        const adapter = makeAdapter();
        const router = new AgentEventRouter(adapter);
        const orchestrator = {
            registerApprovalRequest: vi.fn(),
            finishTurn: vi.fn()
        };
        const pipeline = new EventPipeline(router, orchestrator as never);
        const source = new FakeNotificationSource();

        // First bind to chat-A
        bindTurn(pipeline, source, {
            chatId: "chat-A",
            threadName: "thread-a",
            threadId: "thr-1",
            turnId: "turn-1"
        });

        // Rebind same source to chat-B
        bindTurn(pipeline, source, {
            chatId: "chat-B",
            threadName: "thread-b",
            threadId: "thr-2",
            turnId: "turn-2"
        });

        source.emit({ type: "agent_message_content_delta", delta: "hello" });
        await flush();

        expect(adapter.appendContent).toHaveBeenCalledTimes(1);
        expect(adapter.appendContent).toHaveBeenCalledWith(
            "chat-B",
            "turn-2",
            "hello"
        );
    });

    it("[R8-2] rebinding same source to same chatId with new turnId uses latest route", async () => {
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
        bindTurn(pipeline, source, {
            chatId: "chat-1",
            threadName: "thread-a",
            threadId: "thr-1",
            turnId: "turn-2"
        });

        source.emit({ type: "agent_message_content_delta", delta: "update" });
        await flush();

        // Route should use turnId from the latest bind
        expect(adapter.appendContent).toHaveBeenCalledTimes(1);
        // The stream chunk should reflect the context from latest route
        expect(adapter.appendContent).toHaveBeenCalledWith(
            "chat-1",
            "turn-2",
            "update"
        );
    });

    // ──────────── Issue #9: unhandled Promise rejection ────────────

    it("[R9-1] adapter error in notification handler should not crash the process", async () => {
        const adapter = makeAdapter();
        adapter.appendContent.mockRejectedValueOnce(new Error("feishu API 429 rate limited"));
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

        // Track unhandled rejections
        const unhandledRejections: Error[] = [];
        const rejectionHandler = (error: unknown) => {
            unhandledRejections.push(error as Error);
        };
        process.on("unhandledRejection", rejectionHandler);

        source.emit({ type: "agent_message_content_delta", delta: "will fail" });
        await flush();
        await new Promise((resolve) => setTimeout(resolve, 50));

        process.removeListener("unhandledRejection", rejectionHandler);

        expect(unhandledRejections).toHaveLength(0);
    });

    it("[R9-2] adapter error should be isolated — subsequent events still processed", async () => {
        const adapter = makeAdapter();
        adapter.appendContent
            .mockRejectedValueOnce(new Error("transient failure"))
            .mockResolvedValue(undefined);
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

        const caughtRejections: Error[] = [];
        const rejectionHandler = (error: unknown) => {
            caughtRejections.push(error as Error);
        };
        process.on("unhandledRejection", rejectionHandler);

        source.emit({ type: "agent_message_content_delta", delta: "fail" });
        await flush();
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Second event should still be processed
        source.emit({ type: "agent_message_content_delta", delta: "succeed" });
        await flush();
        await new Promise((resolve) => setTimeout(resolve, 50));

        process.removeListener("unhandledRejection", rejectionHandler);

        expect(caughtRejections).toHaveLength(0);
        expect(adapter.appendContent.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    // ──────────── Issue #13: TurnContext memory leak ────────────

    it("[R13-1] turn context is cleaned up after task_complete", async () => {
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

        // Build up context
        source.emit({
            type: "turn_diff",
            unified_diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new"
        });
        source.emit({
            type: "token_count",
            info: { last_token_usage: { input_tokens: 10, output_tokens: 20 } }
        });
        await flush();

        // Complete the turn
        source.emit({ type: "task_complete", turn_id: "turn-1" });
        await flush();

        // Verify cleanup happened (summary was sent = context was consumed)
        expect(adapter.completeTurn).toHaveBeenCalledWith(
            "chat-1",
            expect.objectContaining({ kind: "turn_summary", turnId: "turn-1" })
        );

        // Replaying task_complete for the same turn should not leak prior context
        source.emit({
            type: "task_complete",
            turn_id: "turn-1"
        });
        await flush();

        expect(adapter.completeTurn).toHaveBeenCalledTimes(1);
    });

    it("[R13-2] stale turn context is pruned by TTL when turn never completes", async () => {
        const adapter = makeAdapter();
        const router = new AgentEventRouter(adapter);
        const orchestrator = {
            registerApprovalRequest: vi.fn(),
            finishTurn: vi.fn()
        };
        const pipeline = new EventPipeline(router, orchestrator as never, { contextTtlMs: 10 });
        const source = new FakeNotificationSource();

        bindTurn(pipeline, source, {
            chatId: "chat-1",
            threadName: "thread-a",
            threadId: "thr-1",
            turnId: "turn-orphan"
        });

        // Build up context but never send task_complete
        source.emit({
            type: "turn_diff",
            unified_diff: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new"
        });
        await flush();

        // file_change is accumulated in TurnContext but not sent to adapter directly
        // Wait for TTL to expire — context gets pruned
        await new Promise((resolve) => setTimeout(resolve, 30));

        source.emit({ type: "task_complete", turn_id: "turn-orphan" });
        await flush();

        // After TTL prune, task_complete creates fresh context → empty filesChanged
        const firstCall = adapter.completeTurn.mock.calls[0] as unknown as
            | [string, { filesChanged?: string[] }]
            | undefined;
        expect(firstCall).toBeDefined();
        if (!firstCall) {
            throw new Error("missing first completeTurn call");
        }
        const summary = firstCall[1];
        expect(summary.filesChanged).toEqual([]);
    });
});
