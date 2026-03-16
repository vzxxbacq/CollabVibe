import { describe, expect, it } from "vitest";

import { acpEventToUnifiedAgentEvent } from "../../../src/acp-event-bridge";

describe("acp-event-bridge", () => {
  it("maps permission requests and keeps unknown options denied", () => {
    expect(acpEventToUnifiedAgentEvent({
      type: "requestPermission",
      requestId: "appr-1",
      turnId: "turn-1",
      toolCallId: "call-1",
      permissionKind: "exec",
      description: "run command",
      options: [{ id: "allow_once" }, { id: "deny" }, { id: "mystery" }]
    })).toEqual({
      type: "approval_request",
      approvalId: "appr-1",
      turnId: "turn-1",
      callId: "call-1",
      approvalType: "command_exec",
      description: "run command",
      availableActions: ["approve", "deny"],
      backendType: "acp"
    });

    expect(acpEventToUnifiedAgentEvent({
      type: "requestPermission",
      requestId: "appr-2",
      turnId: "turn-2",
      toolCallId: "call-2",
      permissionKind: "file_write",
      description: "apply patch",
      options: [{ id: "mystery" }]
    })).toMatchObject({
      type: "approval_request",
      approvalType: "file_change",
      availableActions: ["deny"]
    });
  });

  it("maps tool output, diff, and lifecycle events", () => {
    expect(acpEventToUnifiedAgentEvent({
      type: "tool_call",
      toolCallId: "call-1",
      kind: "execute",
      label: "npm test"
    })).toEqual({
      type: "tool_begin",
      callId: "call-1",
      tool: "exec_command",
      label: "npm test"
    });

    expect(acpEventToUnifiedAgentEvent({
      type: "tool_call_update",
      toolCallId: "call-1",
      contentType: "terminal",
      delta: "ok"
    })).toEqual({
      type: "tool_output",
      callId: "call-1",
      delta: "ok",
      source: "stdout"
    });

    expect(acpEventToUnifiedAgentEvent({
      type: "tool_call_update",
      contentType: "diff",
      diff: "diff --git a/a.txt b/a.txt\n+hello\n"
    })).toBeNull();

    expect(acpEventToUnifiedAgentEvent({
      type: "prompt_response",
      stopReason: "end_turn",
      lastAgentMessage: "done"
    })).toEqual({
      type: "turn_complete",
      lastAgentMessage: "done"
    });
  });
});
