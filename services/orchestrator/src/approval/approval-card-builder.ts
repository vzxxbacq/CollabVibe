import type { IMApprovalRequest } from "../../../contracts/im/index";

export class ApprovalCardBuilder {
  build(request: IMApprovalRequest): Record<string, unknown> {
    const title = request.approvalType === "command_exec" ? "命令审批" : "文件变更审批";
    return {
      header: {
        title: {
          tag: "plain_text",
          content: title
        }
      },
      elements: [
        { tag: "markdown", content: request.description },
        {
          tag: "action",
          actions: request.availableActions.map((action) => ({
            tag: "button",
            text: { tag: "plain_text", content: action },
            value: { action, callId: request.callId, turnId: request.turnId }
          }))
        }
      ]
    };
  }
}
