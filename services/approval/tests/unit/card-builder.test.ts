import { describe, expect, it } from "vitest";

import { ApprovalCardBuilder } from "../../src/approval-card-builder";

describe("card-builder", () => {
  it("renders command approval and file-change approval cards", () => {
    const builder = new ApprovalCardBuilder();
    const commandCard = builder.build({
      kind: "approval",
      threadId: "thr-1",
      turnId: "turn-1",
      approvalId: "appr-1",
      callId: "call-1",
      approvalType: "command_exec",
      description: "审批命令",
      availableActions: ["approve", "deny", "approve_always"]
    });
    const fileCard = builder.build({
      kind: "approval",
      threadId: "thr-1",
      turnId: "turn-1",
      approvalId: "appr-2",
      callId: "call-2",
      approvalType: "file_change",
      description: "审批变更",
      availableActions: ["approve", "deny", "approve_always"]
    });

    expect(commandCard).toMatchObject({
      header: {
        title: { content: "命令审批" }
      }
    });
    expect(fileCard).toMatchObject({
      header: {
        title: { content: "文件变更审批" }
      }
    });
  });
});
