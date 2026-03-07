import { describe, expect, it } from "vitest";

import { routeIntent } from "../src/intent-router";
import type { UnifiedMessage } from "../src/types";

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
  it("routes /project create", () => {
    const parsed = routeIntent(commandMessage("/project create --name payment-api"));
    expect(parsed.intent).toBe("PROJECT_CREATE");
    expect(parsed.args.name).toBe("payment-api");
  });

  it("routes /thread new", () => {
    const parsed = routeIntent(commandMessage("/thread new --project payment"));
    expect(parsed.intent).toBe("THREAD_NEW");
    expect(parsed.args.project).toBe("payment");
  });

  it("routes /project list", () => {
    const parsed = routeIntent(commandMessage("/project list --page 2"));
    expect(parsed.intent).toBe("PROJECT_LIST");
    expect(parsed.args.page).toBe("2");
  });

  it("routes /thread resume", () => {
    const parsed = routeIntent(commandMessage("/thread resume --id thr-1"));
    expect(parsed.intent).toBe("THREAD_RESUME");
    expect(parsed.args.id).toBe("thr-1");
  });

  it("routes /skill install", () => {
    const parsed = routeIntent(commandMessage("/skill install --name skill-creator"));
    expect(parsed.intent).toBe("SKILL_INSTALL");
    expect(parsed.args.name).toBe("skill-creator");
  });

  it("routes /skill list", () => {
    const parsed = routeIntent(commandMessage("/skill list"));
    expect(parsed.intent).toBe("SKILL_LIST");
  });

  it("routes /interrupt to TURN_INTERRUPT", () => {
    const parsed = routeIntent(commandMessage("/interrupt --turn turn-1"));
    expect(parsed.intent).toBe("TURN_INTERRUPT");
    expect(parsed.args.turn).toBe("turn-1");
  });

  it("routes plain text to turn start", () => {
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

  it("routes card_action to UNKNOWN", () => {
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

  it("routes unknown command to UNKNOWN", () => {
    const parsed = routeIntent(commandMessage("/unknown --name value"));
    expect(parsed.intent).toBe("UNKNOWN");
    expect(parsed.command).toBe("/unknown");
  });

  it("routes slash-only command to UNKNOWN", () => {
    const parsed = routeIntent(commandMessage("/"));
    expect(parsed.intent).toBe("UNKNOWN");
    expect(parsed.command).toBe("/");
  });

  it("routes empty command text to UNKNOWN", () => {
    const parsed = routeIntent(commandMessage(""));
    expect(parsed.intent).toBe("UNKNOWN");
  });

  it("keeps special characters in command args", () => {
    const parsed = routeIntent(commandMessage("/project create --name \"pay\\nment\""));
    expect(parsed.intent).toBe("PROJECT_CREATE");
    expect(parsed.args.name).toBe("\"pay\\nment\"");
  });

  it("handles quoted arguments with spaces", () => {
    const parsed = routeIntent(commandMessage("/project create --name \"my api\""));
    expect(parsed.intent).toBe("PROJECT_CREATE");
    expect(parsed.args.name).toBe("my api");
  });
});
