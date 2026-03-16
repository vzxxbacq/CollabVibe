import { describe, expect, it } from "vitest";

import { parseApprovalRequestEvent } from "../../../src/approval";

describe("approval-events", () => {
  it("parses exec_approval_request and protocol alias event", () => {
    const execEvent = parseApprovalRequestEvent({
      type: "exec_approval_request",
      call_id: "call-1",
      approval_id: "appr-1",
      turn_id: "turn-1",
      command: ["npm", "test"]
    });
    const aliasEvent = parseApprovalRequestEvent({
      method: "item/commandExecution/requestApproval",
      callId: "call-2",
      approvalId: "appr-2",
      turnId: "turn-2",
      command: ["git", "push"]
    });

    expect(execEvent).toEqual({
      type: "command_exec",
      requestId: "appr-1",
      callId: "call-1",
      turnId: "turn-1",
      description: "Command approval requested: npm test",
      command: ["npm", "test"]
    });
    expect(aliasEvent?.type).toBe("command_exec");
    expect(aliasEvent?.requestId).toBe("appr-2");
  });

  it("parses apply_patch_approval_request and alias event", () => {
    const event = parseApprovalRequestEvent({
      type: "apply_patch_approval_request",
      call_id: "call-3",
      turn_id: "turn-3",
      changes: { "src/a.ts": { kind: "modified" } }
    });
    const aliasEvent = parseApprovalRequestEvent({
      method: "item/fileChange/requestApproval",
      callId: "call-4",
      turnId: "turn-4",
      changes: { "README.md": { kind: "added" } }
    });

    expect(event).toEqual({
      type: "file_change",
      requestId: "call-3",
      callId: "call-3",
      turnId: "turn-3",
      description: "File change approval requested",
      changes: { "src/a.ts": { kind: "modified" } }
    });
    expect(aliasEvent?.requestId).toBe("call-4");
  });

  it("returns null for unknown or invalid approval payload", () => {
    expect(parseApprovalRequestEvent({ type: "session_configured" })).toBeNull();
    expect(
      parseApprovalRequestEvent({
        type: "exec_approval_request",
        call_id: "call-1"
      })
    ).toBeNull();
    expect(parseApprovalRequestEvent("bad")).toBeNull();
  });

  it("rejects invalid command payload and type mismatches", () => {
    expect(
      parseApprovalRequestEvent({
        type: "exec_approval_request",
        call_id: "call-1",
        approval_id: "appr-1",
        turn_id: "turn-1",
        command: []
      })
    ).toBeNull();
    expect(
      parseApprovalRequestEvent({
        type: "exec_approval_request",
        call_id: "call-1",
        approval_id: "appr-1",
        turn_id: "turn-1",
        command: "npm test"
      })
    ).toBeNull();
    expect(
      parseApprovalRequestEvent({
        type: "apply_patch_approval_request",
        call_id: "call-1",
        turn_id: "turn-1",
        changes: "not-an-object"
      })
    ).toBeNull();
  });
});
