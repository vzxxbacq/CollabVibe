import { describe, expect, it } from "vitest";

import { assertUnifiedMessage, isUnifiedMessage } from "../src/unified-message";

describe("unified message schema", () => {
  it("accepts command messages", () => {
    const message = {
      channel: "feishu",
      eventId: "evt-1",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      raw: {},
      type: "command",
      text: "/thread new",
      command: "/thread",
      args: ["new"]
    };

    expect(isUnifiedMessage(message)).toBe(true);
    expect(assertUnifiedMessage(message).type).toBe("command");
  });

  it("accepts text messages", () => {
    const message = {
      channel: "feishu",
      eventId: "evt-2",
      traceId: "trace-2",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      raw: {},
      type: "text",
      text: "hello",
      mentions: ["ou-2"]
    };

    expect(isUnifiedMessage(message)).toBe(true);
    expect(assertUnifiedMessage(message).traceId).toBe("trace-2");
  });

  it("accepts card action messages", () => {
    const message = {
      channel: "feishu",
      eventId: "evt-3",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      raw: {},
      type: "card_action",
      action: "approve",
      value: {
        approvalId: "appr-1"
      }
    };

    expect(isUnifiedMessage(message)).toBe(true);
  });

  it("rejects invalid payload", () => {
    const badMessage = {
      channel: "feishu",
      type: "text"
    };

    expect(isUnifiedMessage(badMessage)).toBe(false);
    expect(() => assertUnifiedMessage(badMessage)).toThrowError("Invalid unified message");
  });

  it("rejects payload without raw field", () => {
    const missingRaw = {
      channel: "feishu",
      eventId: "evt-4",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      type: "text",
      text: "hello",
      mentions: []
    };

    expect(isUnifiedMessage(missingRaw)).toBe(false);
  });

  it("rejects payload with unsupported type", () => {
    const badType = {
      channel: "feishu",
      eventId: "evt-5",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      raw: {},
      type: "file",
      text: "hello"
    };

    expect(isUnifiedMessage(badType)).toBe(false);
  });

  it("assertUnifiedMessage throws for null and undefined", () => {
    expect(() => assertUnifiedMessage(null)).toThrowError("Invalid unified message");
    expect(() => assertUnifiedMessage(undefined)).toThrowError("Invalid unified message");
  });
});
