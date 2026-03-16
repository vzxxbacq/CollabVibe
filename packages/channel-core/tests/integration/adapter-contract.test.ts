import { describe, expect, it } from "vitest";

import { BaseChannelAdapter } from "../../src/channel-adapter";
import { ChannelError } from "../../src/errors";
import type { UnifiedMessage, UnifiedResponse } from "../../src/types";
import { isUnifiedMessage } from "../../src/unified-message";

class TestAdapter extends BaseChannelAdapter {
  verifyWebhook(headers: Record<string, string>, _body: string): void {
    if (headers["x-signature"] !== "ok") {
      throw new ChannelError("CHANNEL_INVALID_SIGNATURE", "invalid signature");
    }
  }

  parseInboundEvent(payload: unknown): UnifiedMessage {
    const input = payload as { chatId?: string; userId?: string; text?: string; traceId?: string };
    if (!input.chatId || !input.userId || typeof input.text !== "string") {
      throw new ChannelError("CHANNEL_PARSE_FAILED", "invalid payload");
    }
    return {
      channel: "feishu",
      eventId: "evt",
      traceId: input.traceId,
      chatId: input.chatId,
      userId: input.userId,
      timestamp: Date.now(),
      raw: payload,
      type: "text",
      text: input.text,
      mentions: []
    };
  }

  async sendMessage(response: UnifiedResponse): Promise<string> {
    if (!response.text) {
      throw new ChannelError("CHANNEL_REQUEST_FAILED", "text is required");
    }
    return "msg-token";
  }

  async sendInteractiveCard(chatId: string, card: Record<string, unknown>): Promise<string> {
    if (!chatId || !Object.keys(card).length) {
      throw new ChannelError("CHANNEL_REQUEST_FAILED", "invalid card payload");
    }
    return "card-token";
  }

  async updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void> {
    if (!cardToken || !Object.keys(card).length) {
      throw new ChannelError("CHANNEL_REQUEST_FAILED", "missing card token");
    }
  }

  async resolveUserIdentity(userRef: string): Promise<{ externalUserId: string; displayName: string; }> {
    return {
      externalUserId: userRef,
      displayName: "tester"
    };
  }
}

describe("channel adapter contract", () => {
  it("rejects invalid webhook signatures", () => {
    const adapter = new TestAdapter();
    expect(() => adapter.verifyWebhook({ "x-signature": "bad" }, "{}")).toThrow(ChannelError);
  });

  it("parses inbound payload to a valid unified message", () => {
    const adapter = new TestAdapter();
    const parsed = adapter.parseInboundEvent({
      chatId: "oc-1",
      userId: "ou-1",
      text: "hello",
      traceId: "trace-1"
    });
    expect(isUnifiedMessage(parsed)).toBe(true);
    expect(parsed.traceId).toBe("trace-1");
  });

  it("rejects malformed inbound payload", () => {
    const adapter = new TestAdapter();
    expect(() => adapter.parseInboundEvent({ chatId: "oc-1" })).toThrow(ChannelError);
  });

  it("sends text/card payloads and returns tokens", async () => {
    const adapter = new TestAdapter();
    await expect(adapter.sendMessage({ chatId: "oc", text: "hi" })).resolves.toBe("msg-token");
    await expect(adapter.sendInteractiveCard("oc", { title: "test" })).resolves.toBe("card-token");
    await expect(adapter.updateInteractiveCard("card-token", { title: "updated" })).resolves.toBeUndefined();
  });

  it("rejects invalid updateInteractiveCard payload", async () => {
    const adapter = new TestAdapter();
    await expect(adapter.updateInteractiveCard("card-token", {})).rejects.toBeInstanceOf(ChannelError);
  });

  it("resolves identity in a stable shape", async () => {
    const adapter = new TestAdapter();
    await expect(adapter.resolveUserIdentity("ou-1")).resolves.toEqual({
      externalUserId: "ou-1",
      displayName: "tester"
    });
  });
});
