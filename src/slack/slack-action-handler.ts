/**
 * @module src/slack/slack-action-handler
 * @layer Slack (platform-specific)
 *
 * Slack interactive action handler for the currently supported Block Kit actions.
 */
import { createLogger } from "../logging";
import { SlackActionAdapter } from "./channel/index";
import { PlatformActionRouter } from "../common/platform-action-router";
import { buildSlackHelpPanelPayload, sendThreadNewForm } from "./shared-handlers";
import { SlackOutputGateway } from "./platform-output-dispatcher";
import { resolveProjectByChatId } from "../common/project-resolution";
import { textNotification } from "../common/output-helpers";
import type { MergeResult } from "../../services/index";
import type { SlackHandlerDeps } from "./types";

import type { OutputGateway } from "../common/platform-output";

const log = createLogger("slack-action");
const slackActionAdapter = new SlackActionAdapter();

function outputDispatcher(deps: SlackHandlerDeps): OutputGateway {
  return new SlackOutputGateway(deps);
}

async function dispatchMergeResult(
  deps: SlackHandlerDeps,
  chatId: string,
  result: MergeResult
): Promise<void> {
  const dispatcher = outputDispatcher(deps);
  switch (result.kind) {
    case "review":
      await deps.platformOutput.sendFileReview(chatId, result.data);
      return;
    case "summary":
      await deps.platformOutput.sendMergeSummary(chatId, result.data);
      return;
    case "preview":
      await dispatcher.dispatch(chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "preview",
            branchName: "",
            baseBranch: result.baseBranch,
            message: "Merge preview ready.",
            diffStats: result.diffStats,
          },
        },
      });
      return;
    case "conflict":
      await dispatcher.dispatch(chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "conflict",
            branchName: "",
            baseBranch: result.baseBranch,
            message: "Merge conflict detected.",
            conflicts: result.conflicts,
          },
        },
      });
      return;
    case "success":
      await dispatcher.dispatch(chatId, textNotification(result.message ?? "Merge completed."));
      return;
    case "rejected":
      await dispatcher.dispatch(chatId, textNotification(result.message));
      return;
  }
}

const slackActionRouter = new PlatformActionRouter<SlackHandlerDeps, void>({
  interruptTurn: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const projectId = project.id;
    const result = await deps.api.interruptTurn({ projectId, actorId: action.actorId, userId: action.actorId });
    if (result.interrupted && action.turnId) {
      await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "interrupted");
      return;
    }
    await dispatcher.dispatch(action.chatId, textNotification(result.interrupted ? "Turn interrupted." : "No running turn to interrupt."));
  },
  helpPanel: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (action.panel === "help_merge") {
      await dispatcher.dispatch(action.chatId, textNotification("Merge help panel is not supported on Slack."));
      return;
    }
    const panel = await buildSlackHelpPanelPayload(
      deps,
      action.chatId,
      action.actorId,
      action.panel === "help_project" ? "help_home" : action.panel,
      action.messageId
    );
    if (!panel) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "help_panel", panel });
  },
  helpThreadNew: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const panel = await buildSlackHelpPanelPayload(deps, action.chatId, action.actorId, "help_threads", action.messageId);
    if (!panel) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "help_panel", panel });
    await sendThreadNewForm(deps, action.chatId, action.actorId);
  },
  acceptTurn: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.turnId) {
      await dispatcher.dispatch(action.chatId, textNotification("Accept requires a turnId."));
      return;
    }
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const result = await deps.api.acceptTurn({ projectId: project.id, turnId: action.turnId, actorId: action.actorId });
    if (result.accepted) {
      await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "accepted");
      return;
    }
    await dispatcher.dispatch(action.chatId, textNotification("Turn is not awaiting approval."));
  },
  revertTurn: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.turnId) {
      await dispatcher.dispatch(action.chatId, textNotification("Revert requires a turnId."));
      return;
    }
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const result = await deps.api.revertTurn({ projectId: project.id, turnId: action.turnId, actorId: action.actorId });
    if (result.rolledBack) {
      await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "reverted");
      return;
    }
    await dispatcher.dispatch(action.chatId, textNotification("Turn could not be reverted."));
  },
  approvalDecision: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    if (!action.approvalId) {
      await dispatcher.dispatch(action.chatId, textNotification("Approval action requires an approval id."));
      return;
    }
    const mappedDecision = action.decision === "approve" ? "accept" as const
      : action.decision === "deny" ? "decline" as const
      : "approve_always" as const;
    const result = await deps.api.handleApprovalCallback({
      approvalId: action.approvalId,
      decision: mappedDecision,
      actorId: action.actorId,
      includeDisplay: true,
    });
    const approvalResult = typeof result === "string" ? { status: result } : result;
    const approval = approvalResult.approval;
    const actorPart = approval?.actorId ? ` by ${approval.actorId}` : "";
    const timePart = approval?.resolvedAt ?? approval?.expiredAt ? ` at ${approval?.resolvedAt ?? approval?.expiredAt}` : "";
    const reasonPart = approval?.statusReason ? ` (${approval.statusReason})` : "";
    if (approvalResult.status === "duplicate") {
      await dispatcher.dispatch(action.chatId, textNotification(`Approval already processed${actorPart}${timePart}${reasonPart}.`));
      return;
    }
    if (approvalResult.status === "expired") {
      await dispatcher.dispatch(action.chatId, textNotification(`Approval expired${timePart}${reasonPart}.`));
      return;
    }
    if (approvalResult.status === "invalid") {
      await dispatcher.dispatch(action.chatId, textNotification("Approval not found."));
      return;
    }
    await dispatcher.dispatch(action.chatId, textNotification(`Approval ${action.decision} applied${actorPart}${timePart}${reasonPart}.`));
  },
  mergeConfirm: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.branchName) {
      await dispatcher.dispatch(action.chatId, textNotification("Confirm merge requires a branch name."));
      return;
    }
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const result = await deps.api.handleMergeConfirm({ projectId: project.id, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
    await dispatchMergeResult(deps, action.chatId, result);
  },
  mergeCancel: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.branchName) {
      await dispatcher.dispatch(action.chatId, textNotification("Cancel merge requires a branch name."));
      return;
    }
    await dispatcher.dispatch(action.chatId, textNotification(`Merge cancelled: ${action.branchName}`));
  },
  mergeReviewCancel: async (deps, action) => {
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await outputDispatcher(deps).dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    await deps.api.cancelMergeReview({ projectId: project.id, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
    await outputDispatcher(deps).dispatch(action.chatId, textNotification(`Merge review cancelled: ${action.branchName}`));
  },
  mergeFileDecision: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.branchName || !action.filePath) {
      await dispatcher.dispatch(action.chatId, textNotification("Merge file action requires branchName and filePath."));
      return;
    }
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const result = await deps.api.mergeDecideFile({ projectId: project.id, branchName: action.branchName, filePath: action.filePath, decision: action.decision, actorId: action.actorId, context: { userId: action.actorId } });
    await dispatchMergeResult(deps, action.chatId, result);
  },
  mergeAcceptAll: async (deps, action) => {
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await outputDispatcher(deps).dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const result = await deps.api.mergeAcceptAll({ projectId: project.id, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
    await dispatchMergeResult(deps, action.chatId, result);
  },
  mergeAgentAssist: async (deps, action) => {
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await outputDispatcher(deps).dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const review = await deps.api.resolveConflictsViaAgent({ projectId: project.id, branchName: action.branchName, actorId: action.actorId, prompt: action.prompt, context: { userId: action.actorId } });
    await dispatchMergeResult(deps, action.chatId, review);
  },
  mergeCommit: async (deps, action) => {
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!project) {
      await outputDispatcher(deps).dispatch(action.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    const result = await deps.api.commitMergeReview({ projectId: project.id, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
    await dispatchMergeResult(deps, action.chatId, result);
  }
});

export interface SlackInboundAction {
  chatId: string;
  userId: string;
  action: string;
  messageTs?: string;
  callId?: string;
  turnId?: string;
  threadId?: string;
  approvalType?: "command_exec" | "file_change";
  branchName?: string;
  baseBranch?: string;
  filePath?: string;
  prompt?: string;
}

export async function handleSlackAction(deps: SlackHandlerDeps, input: SlackInboundAction): Promise<void> {
  const action = slackActionAdapter.toAction(input);
  if (!action) {
    return;
  }
  const requestLog = log.child({
    chatId: input.chatId,
    userId: input.userId,
    action: input.action,
    callId: input.callId,
    turnId: input.turnId
  });
  const dispatcher = outputDispatcher(deps);
  try {
    const routed = await slackActionRouter.route(deps, action);
    if (action.kind === "raw") {
      await dispatcher.dispatch(input.chatId, textNotification(`Slack action ${action.actionId} is not wired yet.`));
      return;
    }
    if (typeof routed === "undefined") {
      await dispatcher.dispatch(input.chatId, textNotification(`Slack action ${input.action} is not wired yet.`));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requestLog.error({ err: message }, "slack action handler failed");
    await dispatcher.dispatch(input.chatId, textNotification(`Slack action error: ${message}`));
  }
}
