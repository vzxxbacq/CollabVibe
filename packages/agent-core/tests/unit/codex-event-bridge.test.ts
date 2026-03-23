import { describe, expect, it } from "vitest";

import { codexNotificationToUnifiedEvent } from "../../src/transports/codex/codex-event-bridge";

describe("codex-event-bridge", () => {
  it("maps interrupted turn/completed notifications to turn_aborted", () => {
    const event = codexNotificationToUnifiedEvent({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "interrupted",
          items: [],
          error: null,
        },
      },
    } as never);

    expect(event).toEqual({
      type: "turn_aborted",
      turnId: "turn-1",
    });
  });

  it("maps completed turn/completed notifications to turn_complete", () => {
    const event = codexNotificationToUnifiedEvent({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "completed",
          items: [],
          error: null,
        },
        lastAgentMessage: "done",
      },
    } as never);

    expect(event).toEqual({
      type: "turn_complete",
      turnId: "turn-1",
      lastAgentMessage: "done",
    });
  });
});
