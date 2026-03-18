import { describe, expect, it, vi } from "vitest";

import { handleInboundWebhook } from "../../src/index";

describe("inbound webhook handler", () => {
  it("returns orchestrator result on success and does not send fallback", async () => {
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-1",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "text" as const,
        text: "hello",
        mentions: []
      }))
    };
    const orchestrator = {
      handleIntent: vi.fn(async () => ({ mode: "turn" as const, id: "turn-1" }))
    };

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {}
    });

    expect(result).toEqual({ ok: true, result: { mode: "turn", id: "turn-1" } });
  });

  it("returns handler_failed when orchestrator fails without service-layer fallback message", async () => {
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-2",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "text" as const,
        text: "hello",
        mentions: []
      }))
    };
    const orchestrator = {
      handleIntent: vi.fn(async () => {
        throw new Error("codex failure");
      })
    };

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {}
    });

    expect(result.ok).toBe(false);
    expect(result).toEqual({ ok: false, error: "handler_failed", retriable: true });
  });

  it("treats command payloads as TURN_START and does not raise legacy command auth errors", async () => {
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-4",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "command" as const,
        text: "/project create --name deny",
        command: "/project",
        args: ["create", "--name", "deny"]
      }))
    };
    const orchestrator = {
      handleIntent: vi.fn(async () => ({ mode: "turn" as const, id: "turn-legacy-command" }))
    };

    await expect(handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {}
    })).resolves.toEqual({
      ok: true,
      result: { mode: "turn", id: "turn-legacy-command" }
    });
    expect(orchestrator.handleIntent).toHaveBeenCalled();
  });
});
