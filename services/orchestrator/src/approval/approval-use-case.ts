import type { AgentApi } from "../../../../packages/agent-core/src/types";
import type { OrchestratorContext, PendingApprovalContext } from "../orchestrator-context";

export class ApprovalUseCase {
  constructor(private readonly ctx: OrchestratorContext) { }

  registerApprovalRequest(params: {
    chatId: string;
    userId?: string;
    approvalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
  }): void {
    const projectThreadKey = this.ctx.toProjectThreadKey(params.chatId, params.threadName);
    const machine = this.ctx.getSessionStateMachine(projectThreadKey);
    if (machine.getState() === "IDLE") {
      machine.transition("RUNNING");
    }
    if (machine.getState() !== "AWAITING_APPROVAL") {
      machine.transition("AWAITING_APPROVAL");
    }

    this.ctx.turnState.setPendingApproval(params.approvalId, {
      projectThreadKey,
      chatId: params.chatId,
      userId: params.userId,
      threadId: params.threadId,
      threadName: params.threadName,
      turnId: params.turnId,
      callId: params.callId,
      approvalType: params.approvalType
    });

    const waitManager = this.ctx.getApprovalWaitManager(projectThreadKey);
    waitManager.waitFor(params.approvalId, () => {
      const timeoutMachine = this.ctx.getSessionStateMachine(projectThreadKey);
      if (timeoutMachine.getState() === "AWAITING_APPROVAL") {
        timeoutMachine.transition("INTERRUPTED");
      }
      this.ctx.turnState.clearPendingApproval(params.approvalId);
    });
  }

  async handleApprovalDecision(approvalId: string, decision: "accept" | "decline" | "approve_always"): Promise<"resolved" | "duplicate"> {
    const context = this.ctx.turnState.getPendingApproval(approvalId);
    if (!context) {
      throw new Error(`invalid approval id: ${approvalId}`);
    }

    const waitManager = this.ctx.getApprovalWaitManager(context.projectThreadKey);
    const waitResult = waitManager.decide(approvalId);
    if (waitResult.status === "duplicate") {
      return "duplicate";
    }

    const machine = this.ctx.getSessionStateMachine(context.projectThreadKey);
    if (machine.getState() === "AWAITING_APPROVAL") {
      machine.transition("RUNNING");
    }

    const codexApi = await this.ctx.resolveAgentApi(context.chatId, context.threadName);
    if (!codexApi.respondApproval) {
      throw new Error(`agent API does not support approval responses for project-thread ${context.chatId}/${context.threadName}`);
    }
    try {
      await codexApi.respondApproval({
        action: decision === "accept" ? "approve" : decision === "decline" ? "deny" : "approve_always",
        approvalId,
        threadId: context.threadId,
        turnId: context.turnId,
        callId: context.callId,
        approvalType: context.approvalType
      });
    } catch (error) {
      if (machine.getState() === "RUNNING") {
        machine.transition("FAILED");
      }
      throw error;
    }

    this.ctx.turnState.clearPendingApproval(approvalId);
    return "resolved";
  }

  async resume(
    approvalId: string,
    action: "approve" | "deny" | "approve_always"
  ): Promise<"resolved" | "duplicate"> {
    const decision: "accept" | "decline" | "approve_always" = action === "approve" ? "accept" : action === "deny" ? "decline" : "approve_always";
    return this.handleApprovalDecision(approvalId, decision);
  }
}
