import { describe, expect, it } from "vitest";

import { routeIntent } from "../../../src/intent-router";

const base = {
  channel: "feishu" as const,
  eventId: "evt-1",
  chatId: "chat-1",
  userId: "u1",
  timestamp: 1,
  raw: {}
};

describe("thread intents", () => {
  it("parses all thread commands as TURN_START", () => {
    expect(
      routeIntent({
        ...base,
        type: "command",
        text: "/thread new fix-retry",
        command: "/thread",
        args: ["new", "fix-retry"]
      }).intent
    ).toBe("TURN_START");
    
    expect(
      routeIntent({
        ...base,
        type: "command",
        text: "/thread join --name fix-retry",
        command: "/thread",
        args: ["join", "--name", "fix-retry"]
      }).intent
    ).toBe("TURN_START");
  });

  it("does not classify card actions as thread turns", () => {
    expect(
      routeIntent({
        ...base,
        type: "card_action",
        action: "approve",
        value: { approvalId: "appr-1" }
      }).intent
    ).toBe("UNKNOWN");
  });
});
