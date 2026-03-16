import { describe, expect, it, vi } from "vitest";

import { SlackSocketHandler, type SlackSocketEvent } from "../../src/slack-socket-handler";

describe("SlackSocketHandler", () => {
    it("dispatches message events to onMessage handler", async () => {
        const handler = new SlackSocketHandler();
        const messageFn = vi.fn(async () => { });
        handler.onMessage(messageFn);

        const event: SlackSocketEvent = {
            type: "events_api",
            envelope_id: "env-1",
            payload: {
                type: "event_callback",
                event: {
                    type: "message",
                    channel: "ch-1",
                    user: "U123",
                    text: "Hello bot",
                    ts: "1234.5678"
                }
            }
        };

        const ack = await handler.handleEvent(event);

        expect(ack).toBe("env-1");
        expect(messageFn).toHaveBeenCalledWith({
            chatId: "ch-1",
            userId: "U123",
            text: "Hello bot",
            messageTs: "1234.5678",
            threadTs: undefined
        });
    });

    it("dispatches app_mention events to onMessage handler", async () => {
        const handler = new SlackSocketHandler();
        const messageFn = vi.fn(async () => { });
        handler.onMessage(messageFn);

        const event: SlackSocketEvent = {
            type: "events_api",
            envelope_id: "env-2",
            payload: {
                type: "event_callback",
                event: {
                    type: "app_mention",
                    channel: "ch-2",
                    user: "U456",
                    text: "<@BOT> run tests",
                    ts: "1234.5679",
                    thread_ts: "1234.0000"
                }
            }
        };

        await handler.handleEvent(event);

        expect(messageFn).toHaveBeenCalledWith({
            chatId: "ch-2",
            userId: "U456",
            text: "<@BOT> run tests",
            messageTs: "1234.5679",
            threadTs: "1234.0000"
        });
    });

    it("dispatches interactive block_actions to onAction handler", async () => {
        const handler = new SlackSocketHandler();
        const actionFn = vi.fn(async () => { });
        handler.onAction(actionFn);

        const event: SlackSocketEvent = {
            type: "interactive",
            envelope_id: "env-3",
            payload: {
                type: "block_actions",
                user: { id: "U789", name: "alice" },
                channel: { id: "ch-3" },
                message: { ts: "1234.5680" },
                actions: [
                    {
                        action_id: "codex_approve",
                        value: JSON.stringify({ action: "approve", callId: "call-1", turnId: "turn-1" }),
                        block_id: "approval_call-1"
                    }
                ]
            }
        };

        const ack = await handler.handleEvent(event);

        expect(ack).toBe("env-3");
        expect(actionFn).toHaveBeenCalledWith({
            chatId: "ch-3",
            userId: "U789",
            action: "approve",
            callId: "call-1",
            turnId: "turn-1"
        });
    });

    it("handles malformed action value gracefully", async () => {
        const handler = new SlackSocketHandler();
        const actionFn = vi.fn(async () => { });
        handler.onAction(actionFn);

        const event: SlackSocketEvent = {
            type: "interactive",
            envelope_id: "env-4",
            payload: {
                type: "block_actions",
                user: { id: "U789", name: "bob" },
                channel: { id: "ch-4" },
                message: { ts: "1234.5681" },
                actions: [
                    {
                        action_id: "codex_custom",
                        value: "not-json",
                        block_id: "block-1"
                    }
                ]
            }
        };

        const ack = await handler.handleEvent(event);

        expect(ack).toBe("env-4");
        expect(actionFn).toHaveBeenCalledWith({
            chatId: "ch-4",
            userId: "U789",
            action: "codex_custom",
            callId: undefined,
            turnId: undefined
        });
    });

    it("does nothing when no handlers registered", async () => {
        const handler = new SlackSocketHandler();

        const event: SlackSocketEvent = {
            type: "events_api",
            envelope_id: "env-5",
            payload: {
                type: "event_callback",
                event: {
                    type: "message",
                    channel: "ch-1",
                    user: "U123",
                    text: "ignored",
                    ts: "1234.5682"
                }
            }
        };

        const ack = await handler.handleEvent(event);
        expect(ack).toBe("env-5");
    });
});
