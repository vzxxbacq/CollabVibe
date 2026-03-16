import { describe, expect, it } from "vitest";

import { codexEventToUnifiedAgentEvent } from "../../../../../packages/codex-client/src/codex-event-bridge";

describe("codex-event-bridge", () => {
  it("maps content delta to unified event", () => {
    expect(codexEventToUnifiedAgentEvent({
      method: "event/msg",
      params: { type: "agent_message_content_delta", delta: "hello" }
    })).toEqual({
      type: "content_delta",
      turnId: "",
      delta: "hello"
    });
  });

  it("returns null for legacy approval request notifications that are no longer bridged here", () => {
    expect(codexEventToUnifiedAgentEvent({
      method: "event/msg",
      params: {
        type: "exec_approval_request",
        approval_id: "appr-1",
        call_id: "call-1",
        turn_id: "turn-1",
        command: ["npm", "test"]
      }
    })).toBeNull();
  });
});
