import { describe, expect, it, vi } from "vitest";

import { SlackOutputAdapter } from "../../src/slack-output-adapter";
import type { SlackMessageClient } from "../../src/slack-message-client";

function makeClient(): SlackMessageClient {
    return {
        postMessage: vi.fn(async () => ({ ts: "msg-ts-1", channel: "ch-1" })),
        updateMessage: vi.fn(async () => undefined),
        deleteMessage: vi.fn(async () => undefined),
        startStream: vi.fn(async () => ({ streamId: "stream-1", ts: "msg-ts-1", channel: "ch-1" })),
        appendStream: vi.fn(async () => undefined),
        stopStream: vi.fn(async () => undefined),
        addReaction: vi.fn(async () => undefined),
        removeReaction: vi.fn(async () => undefined)
    };
}

describe("SlackOutputAdapter", () => {
    // ── appendContent: Stream API ─────────────────────────────────────────

    it("appendContent starts stream on first call and appends delta", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendContent("ch-1", "turn-1", "Hello ");
        await adapter.appendContent("ch-1", "turn-1", "World");

        expect(client.startStream).toHaveBeenCalledTimes(1);
        expect(client.startStream).toHaveBeenCalledWith({
            channel: "ch-1",
            threadTs: undefined
        });
        expect(client.appendStream).toHaveBeenCalledTimes(2);
        expect(client.appendStream).toHaveBeenCalledWith("stream-1", "Hello ");
        expect(client.appendStream).toHaveBeenCalledWith("stream-1", "World");
    });

    it("appendContent reuses existing stream for same turn", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendContent("ch-1", "turn-1", "a");
        await adapter.appendContent("ch-1", "turn-1", "b");
        await adapter.appendContent("ch-1", "turn-1", "c");

        expect(client.startStream).toHaveBeenCalledTimes(1);
        expect(client.appendStream).toHaveBeenCalledTimes(3);
    });

    // ── appendReasoning: buffered ─────────────────────────────────────────

    it("appendReasoning does not send immediately", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendReasoning("ch-1", "turn-1", "thinking...");

        expect(client.postMessage).not.toHaveBeenCalled();
        expect(client.startStream).not.toHaveBeenCalled();
    });

    // ── appendToolOutput: thread reply ────────────────────────────────────

    it("appendToolOutput sends code block as thread reply", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        // First ensure main message exists
        await adapter.appendContent("ch-1", "turn-1", "hello");

        await adapter.appendToolOutput("ch-1", {
            kind: "tool_output",
            turnId: "turn-1",
            callId: "call-1",
            delta: "npm test output",
            source: "stdout"
        });

        expect(client.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: "ch-1",
                threadTs: "msg-ts-1"
            })
        );
    });

    // ── updateProgress ────────────────────────────────────────────────────

    it("updateProgress Updates message with progress blocks", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        // Create main message first
        await adapter.appendContent("ch-1", "turn-1", "content");

        await adapter.updateProgress("ch-1", {
            kind: "progress",
            turnId: "turn-1",
            phase: "begin",
            tool: "exec_command",
            label: "npm test"
        });

        expect(client.updateMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: "ch-1",
                ts: "msg-ts-1"
            })
        );
    });

    // ── requestApproval: thread reply ─────────────────────────────────────

    it("requestApproval sends approval blocks as thread reply", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendContent("ch-1", "turn-1", "hi");

        await adapter.requestApproval("ch-1", {
            kind: "approval",
            threadId: "thr-1",
            turnId: "turn-1",
            callId: "call-1",
            approvalType: "command_exec",
            description: "Run npm test",
            command: ["npm", "test"],
            availableActions: ["approve", "deny"]
        });

        const call = (client.postMessage as ReturnType<typeof vi.fn>).mock.calls.find(
            (c: unknown[]) => JSON.stringify(c[0]).includes("Approval Required")
        );
        expect(call).toBeDefined();
        expect((call![0] as { threadTs: string }).threadTs).toBe("msg-ts-1");
    });

    // ── completeTurn: stop stream + update ────────────────────────────────

    it("completeTurn stops stream and updates message with summary", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendContent("ch-1", "turn-1", "result text");

        await adapter.completeTurn("ch-1", {
            kind: "turn_summary",
            threadId: "thr-1",
            turnId: "turn-1",
            filesChanged: ["a.ts"],
            tokenUsage: { input: 100, output: 50 }
        });

        expect(client.stopStream).toHaveBeenCalledWith("stream-1");
        expect(client.updateMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: "ch-1",
                ts: "msg-ts-1"
            })
        );

        // Check blocks contain summary
        const updateCall = (client.updateMessage as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0] as { blocks: Array<Record<string, unknown>> };
        const texts = JSON.stringify(updateCall.blocks);
        expect(texts).toContain("Completed");
        expect(texts).toContain("150 tokens");
    });

    // ── notify: error sends message ───────────────────────────────────────

    it("notify with error sends independent message", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.notify("ch-1", {
            kind: "notification",
            threadId: "thr-1",
            category: "error",
            title: "Rate limited",
            detail: "Try again"
        });

        expect(client.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                channel: "ch-1"
            })
        );
        const blocks = (client.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].blocks as Array<{ text?: { text?: string } }>;
        const text = JSON.stringify(blocks);
        expect(text).toContain("Rate limited");
    });

    it("notify with token_usage adds reaction", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendContent("ch-1", "turn-1", "x");

        await adapter.notify("ch-1", {
            kind: "notification",
            threadId: "thr-1",
            turnId: "turn-1",
            category: "token_usage",
            title: "Token update",
            tokenUsage: { input: 100, output: 50 }
        });

        expect(client.addReaction).toHaveBeenCalledWith("ch-1", "msg-ts-1", "zap");
    });

    // ── updateCardAction ──────────────────────────────────────────────────

    it("updateCardAction updates message with action result and cleans up", async () => {
        const client = makeClient();
        const adapter = new SlackOutputAdapter(client);

        await adapter.appendContent("ch-1", "turn-1", "done");
        await adapter.completeTurn("ch-1", {
            kind: "turn_summary",
            threadId: "thr-1",
            turnId: "turn-1",
            filesChanged: [],
            tokenUsage: { input: 10, output: 5 }
        });

        (client.updateMessage as ReturnType<typeof vi.fn>).mockClear();

        await adapter.updateCardAction("ch-1", "turn-1", "accepted");

        expect(client.updateMessage).toHaveBeenCalled();
        const blocks = (client.updateMessage as ReturnType<typeof vi.fn>).mock.calls[0][0].blocks as Array<Record<string, unknown>>;
        const text = JSON.stringify(blocks);
        expect(text).toContain("Approved");
    });
});
