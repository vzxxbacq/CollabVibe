/**
 * Review issue regression tests for FeishuOutputAdapter
 * Covers: #12 (StreamAggregator callback error swallowed),
 *         #14 (cardTokenByTurn/cardState never cleaned up),
 *         #18 (turn_complete + TurnSummary double footer write)
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../channel-core/src/index", async () => {
    const actual = await vi.importActual<typeof import("../../../../channel-core/src/index")>("../../../../channel-core/src/index");
    return {
        ...actual,
        createLogger: vi.fn(() => ({
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn()
        }))
    };
});

import { FeishuOutputAdapter } from "../../../src/feishu-output-adapter";

function makeClient() {
    return {
        sendMessage: vi.fn(async () => "msg-1"),
        sendInteractiveCard: vi.fn(async () => "card-token-1"),
        updateInteractiveCard: vi.fn(async () => undefined),
        pinMessage: vi.fn(async () => undefined)
    };
}

describe("output-adapter-review: regression tests for review issues", () => {
    // ──────────── Issue #12: StreamAggregator callback swallows errors ────────────

    it("[R12-1] appendContent error in aggregator callback should not cause unhandled rejection (records current risk)", async () => {
        vi.useFakeTimers();
        const client = makeClient();
        // updateInteractiveCard will fail (simulates feishu API 429)
        client.updateInteractiveCard.mockRejectedValue(new Error("429 Too Many Requests"));

        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        // Track unhandled rejections
        const unhandledRejections: Error[] = [];
        const rejectionHandler = (error: unknown) => {
            unhandledRejections.push(error as Error);
        };
        process.on("unhandledRejection", rejectionHandler);

        await adapter.notify("chat-1", {
            kind: "notification",
            threadId: "thr-1",
            turnId: "turn-1",
            category: "turn_started",
            title: "开始"
        });
        await adapter.appendContent("chat-1", "turn-1", "hello");

        // Advance timer to trigger aggregator flush → appendContent → updateInteractiveCard (rejected)
        await vi.advanceTimersByTimeAsync(500);

        // Wait for microtasks
        await vi.advanceTimersByTimeAsync(100);

        process.removeListener("unhandledRejection", rejectionHandler);
        vi.useRealTimers();

        // CURRENT BEHAVIOR: void discards the rejection
        // After fix: error should be caught and logged, not silently swallowed
        expect(unhandledRejections).toEqual([]);
    });

    // ──────────── Issue #14: Map memory leak (cardTokenByTurn / cardState) ────────────

    it("[R14-1] completed turn state is cleaned up after updateCardAction", async () => {
        const client = makeClient();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        // Complete a turn
        await adapter.notify("chat-1", {
            kind: "notification",
            threadId: "thr-1",
            turnId: "turn-leak-1",
            category: "turn_started",
            title: "开始"
        });
        await adapter.completeTurn("chat-1", {
            kind: "turn_summary",
            threadId: "thr-1",
            turnId: "turn-leak-1",
            filesChanged: ["a.ts"],
            tokenUsage: { input: 10, output: 20 }
        });

        // Cleanup happens via updateCardAction (user clicks "批准")
        await adapter.updateCardAction("chat-1", "turn-leak-1", "accepted");

        // Now start a new card for the same turnId
        client.sendInteractiveCard.mockClear();

        await adapter.updateProgress("chat-1", {
            kind: "progress",
            turnId: "turn-leak-1",
            phase: "begin",
            tool: "exec_command",
            label: "new command"
        });

        expect(client.sendInteractiveCard).toHaveBeenCalled();
    });

    it("[R14-2] completing many turns does not reuse old card tokens", async () => {
        const client = makeClient();
        let cardCounter = 0;
        client.sendInteractiveCard.mockImplementation(async () => {
            cardCounter += 1;
            return `card-token-${cardCounter}`;
        });
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        const turnCount = 50;
        for (let i = 0; i < turnCount; i++) {
            const turnId = `turn-${i}`;
            await adapter.notify("chat-1", {
                kind: "notification",
                threadId: "thr-1",
                turnId,
                category: "turn_started",
                title: "开始"
            });
            await adapter.completeTurn("chat-1", {
                kind: "turn_summary",
                threadId: "thr-1",
                turnId,
                filesChanged: [],
                tokenUsage: { input: 1, output: 1 }
            });
        }

        expect(client.sendInteractiveCard).toHaveBeenCalledTimes(turnCount);
        expect(client.updateInteractiveCard).toHaveBeenCalledTimes(turnCount);
    });

    it("[R14-3] completed turn state retains threadName for later card callbacks", async () => {
        const client = makeClient();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.notify("chat-1", {
            kind: "notification",
            threadId: "thr-m25",
            turnId: "turn-m25-1",
            category: "turn_started",
            title: "开始"
        });
        adapter.setCardThreadName("chat-1", "turn-m25-1", "m25");
        await adapter.completeTurn("chat-1", {
            kind: "turn_summary",
            threadId: "thr-m25",
            turnId: "turn-m25-1",
            filesChanged: ["a.ts"],
            tokenUsage: { input: 10, output: 20 }
        });

        expect(adapter.getTurnCardThreadName("chat-1", "turn-m25-1")).toBe("m25");
    });

    // ──────────── Issue #18: turn_complete + TurnSummary double footer write ────────────

    it("[R18-1] turn_complete notification does not flush; only completeTurn flushes", async () => {
        const client = makeClient();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        // Start a turn
        await adapter.notify("chat-1", {
            kind: "notification",
            threadId: "thr-1",
            turnId: "turn-double",
            category: "turn_started",
            title: "开始"
        });

        client.updateInteractiveCard.mockClear();

        // Send turn_complete notification (no flush in new behavior)
        await adapter.notify("chat-1", {
            kind: "notification",
            threadId: "thr-1",
            turnId: "turn-double",
            category: "turn_complete",
            title: "✅ 任务完成"
        });

        const afterNotification = client.updateInteractiveCard.mock.calls.length;

        // Send turn summary (only flush)
        await adapter.completeTurn("chat-1", {
            kind: "turn_summary",
            threadId: "thr-1",
            turnId: "turn-double",
            filesChanged: ["a.ts"],
            tokenUsage: { input: 100, output: 200 }
        });

        const afterSummary = client.updateInteractiveCard.mock.calls.length;

        // turn_complete no longer flushes
        expect(afterNotification).toBe(0);
        // only summary flushes
        expect(afterSummary).toBe(1);
    });
});
