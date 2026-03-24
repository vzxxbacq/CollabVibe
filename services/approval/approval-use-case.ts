import { randomUUID } from "node:crypto";
import type { AgentApi } from "../../packages/agent-core/src/index";
import { createLogger } from "../../packages/logger/src/index";
import type { PendingApprovalContext } from "./approval-types";
import type { ApprovalDecisionStore } from "./approval-types";
import type { SessionStateService } from "../session/session-state-service";
import { projectThreadKey } from "../session/session-state-service";

const log = createLogger("approval");

export class ApprovalUseCase {
  constructor(
    private readonly sessionState: SessionStateService,
    private readonly store: ApprovalDecisionStore,
    private readonly resolveAgentApi: (projectId: string, threadName: string) => Promise<AgentApi>,
  ) {}

  async registerApprovalRequest(params: {
    projectId: string;
    userId?: string;
    backendApprovalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
    display: PendingApprovalContext["display"];
  }): Promise<{ accepted: boolean; approvalId: string }> {
    const key = projectThreadKey(params.projectId, params.threadName);
    const approvalId = await this.allocateApprovalId(params.backendApprovalId);
    const machine = this.sessionState.getStateMachine(key);
    if (machine.getState() === "INTERRUPTING" || machine.getState() === "INTERRUPTED") {
      return { accepted: false, approvalId };
    }
    if (machine.getState() === "IDLE") {
      machine.transition("RUNNING");
    }
    if (machine.getState() !== "AWAITING_APPROVAL") {
      machine.transition("AWAITING_APPROVAL");
    }

    this.sessionState.turnState.setPendingApproval(approvalId, {
      approvalId,
      backendApprovalId: params.backendApprovalId,
      projectThreadKey: key,
      projectId: params.projectId,
      userId: params.userId,
      threadId: params.threadId,
      threadName: params.threadName,
      turnId: params.turnId,
      callId: params.callId,
      approvalType: params.approvalType,
      display: params.display
    });

    await this.store.create({
      approvalId,
      backendApprovalId: params.backendApprovalId,
      projectId: params.projectId,
      threadId: params.threadId,
      threadName: params.threadName,
      turnId: params.turnId,
      callId: params.callId,
      approvalType: params.approvalType,
      status: "pending",
      createdAt: params.display.createdAt,
      display: params.display,
    });

    log.info({
      projectId: params.projectId,
      threadId: params.threadId,
      threadName: params.threadName,
      turnId: params.turnId,
      approvalId,
      backendApprovalId: params.backendApprovalId,
      approvalIdSource: approvalId === params.backendApprovalId ? "backend_stable" : "system_generated",
      callId: params.callId,
      approvalType: params.approvalType,
    }, "approval registered");

    const waitManager = this.sessionState.getApprovalWaitManager(key);
    waitManager.waitFor(approvalId, () => {
      const timeoutMachine = this.sessionState.getStateMachine(key);
      if (timeoutMachine.getState() === "AWAITING_APPROVAL") {
        timeoutMachine.transition("FAILED");
        timeoutMachine.transition("IDLE");
      }
      const reason = "approval timed out while waiting for decision";
      void this.store.markExpired(approvalId, undefined, reason);
      log.warn({
        projectId: params.projectId,
        threadId: params.threadId,
        threadName: params.threadName,
        turnId: params.turnId,
        approvalId,
        backendApprovalId: params.backendApprovalId,
        callId: params.callId,
        reason,
      }, "approval expired");
      this.sessionState.turnState.clearPendingApproval(approvalId);
    });
    return { accepted: true, approvalId };
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
        approvalId: context.backendApprovalId,
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
    log.info({
      projectId: context.projectId,
      threadId: context.threadId,
      threadName: context.threadName,
      turnId: context.turnId,
      approvalId,
      backendApprovalId: context.backendApprovalId,
      callId: context.callId,
      decision,
    }, "approval resolved");
    return "resolved";
  }

  async resume(
    approvalId: string,
    action: "approve" | "deny" | "approve_always"
  ): Promise<"resolved" | "duplicate"> {
    const decision: "accept" | "decline" | "approve_always" = action === "approve" ? "accept" : action === "deny" ? "decline" : "approve_always";
    return this.handleApprovalDecision(approvalId, decision);
  }

  private async allocateApprovalId(backendApprovalId: string): Promise<string> {
    const normalized = String(backendApprovalId ?? "").trim();
    if (this.canReuseBackendApprovalId(normalized)) {
      const pending = this.sessionState.turnState.getPendingApproval(normalized);
      const persisted = await this.store.getById(normalized);
      if (!pending && !persisted) {
        return normalized;
      }
    }
    return `appr:${randomUUID()}`;
  }

  private canReuseBackendApprovalId(backendApprovalId: string): boolean {
    if (!backendApprovalId) return false;
    if (/^\d+$/.test(backendApprovalId)) return false;
    return /^[A-Za-z][A-Za-z0-9:_-]{2,}$/.test(backendApprovalId);
  }
}
