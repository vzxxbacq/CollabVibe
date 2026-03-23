import type { AgentApi } from "../../packages/agent-core/src/index";
import type { PendingApprovalContext } from "./approval-types";
import type { SessionStateService } from "../session/session-state-service";
import { projectThreadKey } from "../session/session-state-service";

export class ApprovalUseCase {
  constructor(
    private readonly sessionState: SessionStateService,
    private readonly resolveAgentApi: (projectId: string, threadName: string) => Promise<AgentApi>,
  ) {}

  registerApprovalRequest(params: {
    projectId: string;
    userId?: string;
    approvalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
  }): { accepted: boolean } {
    const key = projectThreadKey(params.projectId, params.threadName);
    const machine = this.sessionState.getStateMachine(key);
    if (machine.getState() === "INTERRUPTING" || machine.getState() === "INTERRUPTED") {
      return { accepted: false };
    }
    if (machine.getState() === "IDLE") {
      machine.transition("RUNNING");
    }
    if (machine.getState() !== "AWAITING_APPROVAL") {
      machine.transition("AWAITING_APPROVAL");
    }

    this.sessionState.turnState.setPendingApproval(params.approvalId, {
      projectThreadKey: key,
      projectId: params.projectId,
      userId: params.userId,
      threadId: params.threadId,
      threadName: params.threadName,
      turnId: params.turnId,
      callId: params.callId,
      approvalType: params.approvalType
    });

    const waitManager = this.sessionState.getApprovalWaitManager(key);
    waitManager.waitFor(params.approvalId, () => {
      const timeoutMachine = this.sessionState.getStateMachine(key);
      if (timeoutMachine.getState() === "AWAITING_APPROVAL") {
        timeoutMachine.transition("FAILED");
        timeoutMachine.transition("IDLE");
      }
      this.sessionState.turnState.clearPendingApproval(params.approvalId);
    });
    return { accepted: true };
  }

  async handleApprovalDecision(approvalId: string, decision: "accept" | "decline" | "approve_always"): Promise<"resolved" | "duplicate"> {
    const context = this.sessionState.turnState.getPendingApproval(approvalId);
    if (!context) {
      throw new Error(`invalid approval id: ${approvalId}`);
    }

    const waitManager = this.sessionState.getApprovalWaitManager(context.projectThreadKey);
    const waitResult = waitManager.decide(approvalId);
    if (waitResult.status === "duplicate") {
      return "duplicate";
    }

    const machine = this.sessionState.getStateMachine(context.projectThreadKey);
    if (machine.getState() === "INTERRUPTING" || machine.getState() === "INTERRUPTED") {
      this.sessionState.turnState.clearPendingApproval(approvalId);
      throw new Error(`approval expired for interrupted turn: ${approvalId}`);
    }
    if (machine.getState() === "AWAITING_APPROVAL") {
      machine.transition("RUNNING");
    }

    const codexApi = await this.resolveAgentApi(context.projectId, context.threadName);
    if (!codexApi.respondApproval) {
      throw new Error(`agent API does not support approval responses for project-thread ${context.projectId}/${context.threadName}`);
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

    this.sessionState.turnState.clearPendingApproval(approvalId);
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
