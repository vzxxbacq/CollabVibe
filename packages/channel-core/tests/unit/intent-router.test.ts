import { describe, expect, it } from "vitest";

import { routeIntent } from "../../src/intent-router";
import type { UnifiedMessage } from "../../src/types";

function commandMessage(text: string): UnifiedMessage {
  return {
    channel: "feishu",
    eventId: "evt-cmd",
    chatId: "oc-1",
    userId: "ou-1",
    timestamp: 123,
    raw: {},
    type: "command",
    text,
    command: text.split(" ")[0] || "",
    args: text.split(" ").slice(1)
  };
}

describe("intent router", () => {
  it("routes all local slash commands to TURN_START (parsing removed)", () => {
    const parsed = routeIntent(commandMessage("/project create --name payment-api"));
    expect(parsed.intent).toBe("TURN_START");
  });

  it("routes plain text to TURN_START", () => {
    const parsed = routeIntent({
      channel: "feishu",
      eventId: "evt-text",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      raw: {},
      type: "text",
      text: "fix retry logic",
      mentions: []
    });

    expect(parsed.intent).toBe("TURN_START");
  });

  it("routes card_action to UNKNOWN so webhook/card handlers do not misroute it to agent turns", () => {
    const parsed = routeIntent({
      channel: "feishu",
      eventId: "evt-card",
      chatId: "oc-1",
      userId: "ou-1",
      timestamp: 123,
      raw: {},
      type: "card_action",
      action: "confirm",
      value: { key: "value" }
    });

    expect(parsed.intent).toBe("UNKNOWN");
  });
});
