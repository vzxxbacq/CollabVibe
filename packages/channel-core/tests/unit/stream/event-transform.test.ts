import { describe, expect, it } from "vitest";

import { transformEvent } from "../../../src/event-transformer";

const ctx = {
  chatId: "chat-1",
  threadId: "thr-1",
  turnId: "turn-1"
};

describe("event-transform", () => {
  it("maps agent message delta to stream message chunk", () => {
    const output = transformEvent(
      {
        type: "agent_message_content_delta",
        delta: "hello"
      },
      ctx
    );

    expect(output).toEqual({
      kind: "content",
      turnId: "turn-1",
      delta: "hello"
    });
  });

  it("maps approval events and filters internal events", () => {
    const approval = transformEvent(
      {
        type: "exec_approval_request",
        call_id: "call-1",
        turn_id: "turn-1",
        command: ["npm", "test"]
      },
      ctx
    );
    const filtered = transformEvent(
      {
        type: "session_configured"
      },
      ctx
    );

    expect(approval?.kind).toBe("approval");
    expect(approval).toMatchObject({
      approvalType: "command_exec",
      callId: "call-1"
    });
    expect(filtered).toBeNull();
  });

  it("returns null for unknown event types", () => {
    expect(
      transformEvent(
        {
          type: "unknown_event_type"
        },
        ctx
      )
    ).toBeNull();
  });

  it("maps lifecycle begin/end events", () => {
    const begin = transformEvent(
      {
        type: "exec_command_begin",
        turn_id: "turn-9",
        command: ["npm", "test"]
      },
      ctx
    );
    const end = transformEvent(
      {
        type: "exec_command_end",
        turn_id: "turn-9",
        command: ["npm", "test"],
        aggregated_output: "ok",
        status: "completed",
        exit_code: 0,
        duration: "1s"
      },
      ctx
    );

    expect(begin).toMatchObject({
      kind: "progress",
      phase: "begin",
      tool: "exec_command",
      turnId: "turn-9"
    });
    expect(end).toMatchObject({
      kind: "progress",
      phase: "end",
      tool: "exec_command",
      status: "success",
      exitCode: 0
    });
  });
});
