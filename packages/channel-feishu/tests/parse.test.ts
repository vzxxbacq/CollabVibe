import { describe, expect, it } from "vitest";

import { FeishuAdapter } from "../src/feishu-adapter";
import { noopHttpClient } from "./fixtures/noop-http-client";

const adapter = new FeishuAdapter({
  appId: "id",
  appSecret: "secret",
  signingSecret: "sig",
  httpClient: noopHttpClient,
  now: () => 1000
});

describe("feishu parse inbound", () => {
  it("parses text message", () => {
    const parsed = adapter.parseInboundEvent({
      header: {
        event_id: "evt-text",
        create_time: "1000",
        trace_id: "trace-parse-1"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-1"
          }
        },
        message: {
          chat_id: "oc-1",
          content: JSON.stringify({ text: "hello" }),
          mentions: [{ id: { open_id: "ou-2" } }]
        }
      }
    });

    expect(parsed.type).toBe("text");
    expect(parsed.traceId).toBe("trace-parse-1");
    if (parsed.type === "text") {
      expect(parsed.text).toBe("hello");
      expect(parsed.mentions).toEqual(["ou-2"]);
    }
  });

  it("parses command message", () => {
    const parsed = adapter.parseInboundEvent({
      header: {
        event_id: "evt-cmd",
        create_time: "1000"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-1"
          }
        },
        message: {
          chat_id: "oc-1",
          content: JSON.stringify({ text: "/thread new --project payment" })
        }
      }
    });

    expect(parsed.type).toBe("command");
    if (parsed.type === "command") {
      expect(parsed.command).toBe("/thread");
      expect(parsed.args).toContain("new");
    }
  });

  it("parses card action callback", () => {
    const parsed = adapter.parseInboundEvent({
      type: "card.action",
      header: {
        event_id: "evt-card",
        create_time: "1000"
      },
      event: {
        context: {
          open_chat_id: "oc-1"
        },
        operator: {
          operator_id: {
            open_id: "ou-1"
          }
        },
        action: {
          name: "approve",
          value: {
            approvalId: "appr-1"
          }
        }
      }
    });

    expect(parsed.type).toBe("card_action");
    if (parsed.type === "card_action") {
      expect(parsed.action).toBe("approve");
      expect(parsed.value.approvalId).toBe("appr-1");
    }
  });

  it("handles empty message content as empty text", () => {
    const parsed = adapter.parseInboundEvent({
      header: {
        event_id: "evt-empty-content",
        create_time: "1000"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-1"
          }
        },
        message: {
          chat_id: "oc-1",
          content: ""
        }
      }
    });

    expect(parsed.type).toBe("text");
    if (parsed.type === "text") {
      expect(parsed.text).toBe("");
      expect(parsed.mentions).toEqual([]);
    }
  });

  it("handles content without text field", () => {
    const parsed = adapter.parseInboundEvent({
      header: {
        event_id: "evt-no-text",
        create_time: "1000"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-1"
          }
        },
        message: {
          chat_id: "oc-1",
          content: JSON.stringify({ foo: "bar" })
        }
      }
    });

    expect(parsed.type).toBe("text");
    if (parsed.type === "text") {
      expect(parsed.text).toBe("");
      expect(parsed.mentions).toEqual([]);
    }
  });
});
