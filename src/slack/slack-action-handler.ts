/**
 * @module src/slack/slack-action-handler
 * @layer Slack (platform-specific)
 *
 * Slack interactive action handler for the currently supported Block Kit actions.
 */
import { createLogger } from "../../packages/logger/src/index";
import { SlackActionAdapter } from "./channel/index";
import { PlatformActionRouter } from "../../services/orchestrator/src/commands/platform-action-router";
import { buildSlackHelpPanelPayload, sendThreadNewForm } from "./shared-handlers";
import { SlackOutputGateway } from "./platform-output-dispatcher";
import type { SlackHandlerDeps } from "./types";

import type { OutputGateway } from "../../services/contracts/im/platform-output";

const log = createLogger("slack-action");
const slackActionAdapter = new SlackActionAdapter();

function outputDispatcher(deps: SlackHandlerDeps): OutputGateway {
  return new SlackOutputGateway(deps);
}

const slackActionRouter = new PlatformActionRouter<SlackHandlerDeps, void>({
  interruptTurn: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const result = await deps.orchestrator.handleTurnInterrupt(action.chatId, action.actorId);
    if (result.interrupted && action.turnId) {
      await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "interrupted");
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "text", text: result.interrupted ? "Turn interrupted." : "No running turn to interrupt." });
  },
  helpPanel: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (action.panel === "help_merge") {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Merge help panel is not supported on Slack." });
      return;
    }
    const panel = await buildSlackHelpPanelPayload(deps, action.chatId, action.actorId, action.panel, action.messageId);
    if (!panel) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "help_panel", panel });
  },
  helpThreadNew: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const panel = await buildSlackHelpPanelPayload(deps, action.chatId, action.actorId, "help_threads", action.messageId);
    if (!panel) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "help_panel", panel });
    await sendThreadNewForm(deps, action.chatId, action.actorId);
  },
  acceptTurn: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.turnId) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Accept requires a turnId." });
      return;
    }
    const result = await deps.orchestrator.acceptTurn(action.chatId, action.turnId);
    if (result.accepted) {
      await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "accepted");
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "text", text: "Turn is not awaiting approval." });
  },
  revertTurn: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.turnId) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Revert requires a turnId." });
      return;
    }
    const result = await deps.orchestrator.revertTurn(action.chatId, action.turnId);
    if (result.rolledBack) {
      await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "reverted");
      return;
    }
    await dispatcher.dispatch(action.chatId, { kind: "text", text: "Turn could not be reverted." });
  },
  approvalDecision: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const project = deps.findProjectByChatId(action.chatId);
    if (!project) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
      return;
    }
    if (!action.approvalId) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Approval action requires an approval id." });
      return;
    }
    await deps.approvalHandler.handle({
      approvalId: action.approvalId,
      approverId: action.actorId,
      action: action.decision,
      projectId: project.id,
      threadId: action.threadId,
      turnId: action.turnId,
      approvalType: action.approvalType
    }, true);
    await dispatcher.dispatch(action.chatId, { kind: "text", text: `Approval ${action.decision} applied.` });
  },
  mergeConfirm: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.branchName) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Confirm merge requires a branch name." });
      return;
    }
    const result = await deps.orchestrator.handleMergeConfirm(action.chatId, action.branchName, undefined, { userId: action.actorId });
    await dispatcher.dispatch(action.chatId, { kind: "text", text: result.message });
  },
  mergeCancel: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.branchName) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Cancel merge requires a branch name." });
      return;
    }
    await deps.platformOutput.sendMergeOperation(action.chatId, {
      kind: "thread_merge",
      action: "rejected",
      branchName: action.branchName,
      baseBranch: action.baseBranch ?? "main",
      message: `Merge cancelled: ${action.branchName}`
    });
  },
  mergeReviewCancel: async (deps, action) => {
    await deps.orchestrator.cancelMergeReview(action.chatId, action.branchName, { userId: action.actorId });
    await deps.platformOutput.sendMergeOperation(action.chatId, {
      kind: "thread_merge",
      action: "rejected",
      branchName: action.branchName,
      baseBranch: action.baseBranch ?? "main",
      message: `Merge review cancelled: ${action.branchName}`
    });
  },
  mergeFileDecision: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    if (!action.branchName || !action.filePath) {
      await dispatcher.dispatch(action.chatId, { kind: "text", text: "Merge file action requires branchName and filePath." });
      return;
    }
    const result = await deps.orchestrator.mergeDecideFile(action.chatId, action.branchName, action.filePath, action.decision, { userId: action.actorId });
    if (result.kind === "file_merge_review") {
      await deps.platformOutput.sendFileReview(action.chatId, result);
      return;
    }
    await deps.platformOutput.sendMergeSummary(action.chatId, result);
  },
  mergeAcceptAll: async (deps, action) => {
    const result = await deps.orchestrator.mergeAcceptAll(action.chatId, action.branchName, { userId: action.actorId });
    if (result.kind === "file_merge_review") {
      await deps.platformOutput.sendFileReview(action.chatId, result);
      return;
    }
    await deps.platformOutput.sendMergeSummary(action.chatId, result);
  },
  mergeAgentAssist: async (deps, action) => {
    const review = await deps.orchestrator.resolveConflictsViaAgent(action.chatId, action.branchName, action.prompt, { userId: action.actorId });
    await deps.platformOutput.sendFileReview(action.chatId, review);
  },
  mergeCommit: async (deps, action) => {
    const dispatcher = outputDispatcher(deps);
    const result = await deps.orchestrator.commitMergeReview(action.chatId, action.branchName, { userId: action.actorId });
    await dispatcher.dispatch(action.chatId, { kind: "text", text: result.message });
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
      await dispatcher.dispatch(input.chatId, { kind: "text", text: `Slack action ${action.actionId} is not wired yet.` });
      return;
    }
    if (typeof routed === "undefined") {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: `Slack action ${input.action} is not wired yet.` });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    requestLog.error({ err: message }, "slack action handler failed");
    await dispatcher.dispatch(input.chatId, { kind: "text", text: `Slack action error: ${message}` });
  }
}
