import type { AgentApi } from "../../../../packages/agent-core/src/types";
import type { CodexNotification } from "../../../../packages/agent-core/src/transports/codex/index";
import { codexEventToUnifiedAgentEvent } from "../../../../packages/agent-core/src/transports/codex/codex-event-bridge";
import type { UnifiedAgentEvent } from "../../../../packages/agent-core/src/unified-agent-event";
import { createLogger } from "../../../../packages/logger/src/index";

import type { OrchestratorContext } from "../orchestrator-context";
import { transformUnifiedAgentEvent } from "../event/transformer";

const log = createLogger("merge-turn-runner");

export interface MergeTurnRegistration {
  chatId: string;
  userId?: string;
  traceId?: string;
  threadName: string;
  threadId: string;
  branchName: string;
  kind: "resolver" | "batch" | "retry";
  filePath?: string;
}

interface MergeTurnRunnerCallbacks {
  onResolverTurnComplete(chatId: string, resolverName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }): Promise<void>;
  onMergeResolverDone(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }): Promise<void>;
  onMergeFileRetryDone(chatId: string, branchName: string, filePath: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }): Promise<void>;
}

export class MergeTurnRunner {
  private readonly attachedApis = new WeakSet<AgentApi>();
  private readonly registrations = new Map<string, MergeTurnRegistration>();

  constructor(
    private readonly ctx: Pick<OrchestratorContext, "registerApprovalRequest" | "routeMessage">,
    private readonly callbacks: MergeTurnRunnerCallbacks
  ) { }

  attachApi(api: AgentApi): void {
    if (this.attachedApis.has(api) || !api.onNotification) {
      return;
    }
    this.attachedApis.add(api);
    api.onNotification((notification) => {
      this.handleNotification(notification).catch((error) => {
        log.warn({ err: error instanceof Error ? error.message : String(error) }, "merge notification handling failed");
      });
    });
  }

  registerTurn(turnId: string, registration: MergeTurnRegistration): void {
    this.registrations.set(turnId, registration);
  }

  private toUnified(notification: CodexNotification | UnifiedAgentEvent): UnifiedAgentEvent | null {
    if (typeof (notification as UnifiedAgentEvent).type === "string" && !("method" in (notification as Record<string, unknown>))) {
      return notification as UnifiedAgentEvent;
    }
    return codexEventToUnifiedAgentEvent(notification as CodexNotification);
  }

  private async handleNotification(notification: CodexNotification | UnifiedAgentEvent): Promise<void> {
    const event = this.toUnified(notification);
    if (!event?.turnId) {
      return;
    }
    const registration = this.registrations.get(event.turnId);
    if (!registration) {
      return;
    }

    if (event.type === "approval_request") {
      this.ctx.registerApprovalRequest({
        chatId: registration.chatId,
        userId: registration.userId,
        approvalId: event.approvalId,
        threadId: registration.threadId,
        threadName: registration.threadName,
        turnId: event.turnId,
        callId: event.callId,
        approvalType: event.approvalType
      });
      const message = transformUnifiedAgentEvent(event, {
        chatId: registration.chatId,
        threadId: registration.threadId,
        turnId: event.turnId,
        threadName: registration.threadName
      });
      if (message) {
        await this.ctx.routeMessage(registration.chatId, message);
      }
      return;
    }

    if (event.type !== "turn_complete" && event.type !== "turn_aborted") {
      return;
    }

    this.registrations.delete(event.turnId);
    const callbackContext = {
      traceId: registration.traceId,
      threadId: registration.threadId,
      turnId: event.turnId,
      userId: registration.userId,
      resolverName: registration.threadName
    };

    if (event.type === "turn_aborted") {
      return;
    }

    if (registration.kind === "resolver") {
      await this.callbacks.onResolverTurnComplete(registration.chatId, registration.threadName, callbackContext);
      return;
    }
    if (registration.kind === "retry" && registration.filePath) {
      await this.callbacks.onMergeFileRetryDone(registration.chatId, registration.branchName, registration.filePath, callbackContext);
      return;
    }
    await this.callbacks.onMergeResolverDone(registration.chatId, registration.branchName, callbackContext);
  }
}
