/**
 * @module src/feishu/feishu-card-handler
 * @layer Feishu (platform-specific)
 *
 * Feishu interactive card action handler — the entry point for `card.action.trigger` events.
 *
 * ## Responsibilities
 * - Parse Feishu card action payload (action value, operator, context)
 * - Dispatch to sub-handlers by action type:
 *   - Project init, thread creation, approval, exec_command
 *   - Thread switching, merge operations, snapshot jumps
 *   - Skill management, admin panel operations
 * - Return `CardActionResponse` for in-place card updates
 *
 * ## Import Constraints
 * ✅ May import: src/feishu/types, packages/channel-core, services/*
 * ❌ Must NOT import: src/slack/
 *
 * ## Exports
 * - `handleFeishuCardAction(deps, data)` — primary export
 */
import type { CardActionResponse } from "../handlers/types";
import type { FeishuHandlerDeps } from "./types";
import { FeishuActionAdapter } from "./channel/index";
import { armPendingFeishuSkillInstall, clearFeishuSkillInstallState, consumeStagedFeishuSkillInstall, peekStagedFeishuSkillInstall } from "./skill-file-install-state";
import {
  sendProjectList, sendSnapshotList, sendModelList, sendThreadNewForm,
  resolveHelpCard, resolveHelpThreadCard, resolveHelpThreadNewCard, resolveHelpMergeCard,
  resolveSnapshotCard, resolveHelpSkillCard, resolveHelpBackendCard, resolveHelpTurnCard
} from "./shared-handlers";
import { routeIntent } from "../../services/contracts/im/intent-router";
import type { IntentType } from "../../services/contracts/im/types";
import { MAIN_THREAD_NAME } from "../../services/contracts/im/index";
import { isBackendId, transportFor } from "../../services/orchestrator/src/index";
import { createLogger } from "../../packages/logger/src/index";
import { authorizeIntent } from "../../services/orchestrator/src/iam/index";
import { AuthorizationError } from "../../services/orchestrator/src/iam/index";
import { ErrorCode, OrchestratorError } from "../../services/orchestrator/src/index";
import { execFile as execFileCb } from "node:child_process";
import { join as pathJoin } from "node:path";
import { promisify } from "node:util";
import { getFeishuNotifyCatalog, notify } from "./feishu-notify";
import { getFeishuCardHandlerStrings } from "./feishu-card-handler.strings";
import { rm } from "node:fs/promises";
import { PlatformActionRouter } from "../../services/orchestrator/src/commands/platform-action-router";

const execFileAsync = promisify(execFileCb);

const log = createLogger("action");
const feishuActionAdapter = new FeishuActionAdapter();
const installTaskStore = new Map<string, Array<{ taskId: string; label: string; status: "running" | "success" | "failed"; detail?: string }>>();

class TurnRecoveryError extends Error {
  constructor(
    message: string,
    readonly meta: { turnId: string; chatId: string; projectId: string }
  ) {
    super(message);
    this.name = "TurnRecoveryError";
  }
}

interface CardActionData {
  action?: {
    value?: Record<string, unknown>;
    form_value?: Record<string, string>;
  };
  operator?: { open_id?: string };
  context?: { open_chat_id?: string; open_message_id?: string };
}

function addInstallTask(chatId: string, task: { taskId: string; label: string; status: "running" | "success" | "failed"; detail?: string }): void {
  const tasks = installTaskStore.get(chatId) ?? [];
  tasks.unshift(task);
  installTaskStore.set(chatId, tasks.slice(0, 10));
}

function updateInstallTask(chatId: string, taskId: string, patch: Partial<{ status: "running" | "success" | "failed"; detail?: string }>): void {
  const tasks = installTaskStore.get(chatId) ?? [];
  const target = tasks.find((item) => item.taskId === taskId);
  if (target) Object.assign(target, patch);
}

function rawCard(data: Record<string, unknown>): CardActionResponse {
  return { card: { type: "raw", data } };
}

const feishuActionRouter = new PlatformActionRouter<FeishuHandlerDeps, CardActionResponse | void>({
  interruptTurn: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_INTERRUPT");
    await deps.orchestrator.handleTurnInterrupt(action.chatId, action.actorId || undefined);
    const card = await deps.platformOutput.updateCardAction(action.chatId, action.turnId ?? "", "interrupted");
    return card ? rawCard(card) : undefined;
  },
  acceptTurn: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    if (!action.turnId) return;
    await deps.orchestrator.acceptTurn(action.chatId, action.turnId);
    const card = await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "accepted");
    return card ? rawCard(card) : undefined;
  },
  revertTurn: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    if (!action.turnId) return;
    await deps.orchestrator.revertTurn(action.chatId, action.turnId);
    const card = await deps.platformOutput.updateCardAction(action.chatId, action.turnId, "reverted");
    return card ? rawCard(card) : undefined;
  },
  approvalDecision: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    return handleApprovalAction(deps, action.chatId, action.actorId, action.decision, {
      callId: action.approvalId,
      threadId: action.threadId,
      turnId: action.turnId,
      approvalType: action.approvalType
    });
  },
  userInputReply: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    const callId = String(action.callId ?? "");
    const metaStr = String(actionValue.questionMeta ?? "[]");
    const threadNameFromCard = String(actionValue.threadName ?? "").trim();
    const turnId = String(actionValue.turnId ?? "").trim();
    if (!callId) return;

    let questionMeta: Array<{ idx: number; id: string; defaultAnswer: string }>;
    try { questionMeta = JSON.parse(metaStr); } catch { questionMeta = []; }

    const formValues = payload.action?.form_value ?? {};
    const answers: Record<string, string[]> = {};
    for (const q of questionMeta) {
      const formKey = `q_${q.idx}`;
      const selected = formValues[formKey] ?? q.defaultAnswer;
      answers[q.id] = [String(selected)];
    }

    try {
      const binding = await deps.orchestrator.getUserActiveThread(action.chatId, action.actorId);
      const threadName = threadNameFromCard || binding?.threadName || "__main__";
      await deps.orchestrator.respondUserInput(action.chatId, threadName, callId, answers);

      const summary = questionMeta.map(q => {
        const value = answers[q.id]?.[0] ?? "";
        return `• ${q.id}: **${value}**`;
      }).join("\n");
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      const now = new Date();
      const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      return rawCard({
        schema: "2.0",
        config: { width_mode: "fill" },
        header: {
          title: { tag: "plain_text", content: s.planSelectionSubmittedTitle },
          subtitle: { tag: "plain_text", content: [threadName, turnId].filter(Boolean).join(" · ") },
          icon: { tag: "standard_icon", token: "app_outlined", color: "green" },
          text_tag_list: [
            { tag: "text_tag", text: { tag: "plain_text", content: s.planSelectionSubmittedTag }, color: "green" },
            { tag: "text_tag", text: { tag: "plain_text", content: s.planModeTag }, color: "neutral" }
          ],
          template: "green"
        },
        body: {
          direction: "vertical",
          elements: [
            { tag: "markdown", content: s.planSelectionSubmitted(action.actorId, timeStr) },
            { tag: "markdown", content: summary }
          ]
        }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      await notify(deps, action.chatId, s.submitUserInputFailed(msg));
      return;
    }
  },
  threadCreate: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_NEW");
    const payload = action.raw as CardActionData;
    const actionValue = ((payload.action?.value ?? {}) as Record<string, unknown>);
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        await notify(deps, action.chatId, GUARD.NOT_YOUR_CARD);
        return;
      }
    }
    return handleCreateThreadAction(
      deps,
      payload,
      action.chatId,
      action.actorId,
      actionValue
    );
  },
  threadJoin: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_SWITCH");
    return handleThreadSwitchAction(deps, action.chatId, action.actorId, "switch_thread", {
      threadName: action.threadName
    });
  },
  threadLeave: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_SWITCH");
    return handleThreadSwitchAction(deps, action.chatId, action.actorId, "switch_to_main", {});
  },
  helpPanel: async (deps, action) => {
    switch (action.panel) {
      case "help_home":
        return rawCard(await resolveHelpCard(deps, action.chatId, action.actorId));
      case "help_threads":
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_LIST");
        return rawCard(await resolveHelpThreadCard(deps, action.chatId, action.actorId));
      case "help_history":
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SNAPSHOT_LIST");
        return rawCard(await resolveSnapshotCard(deps, action.chatId, action.actorId, true));
      case "help_skills":
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_LIST");
        return rawCard(await resolveHelpSkillCard(deps, action.chatId, action.actorId));
      case "help_backends":
        return rawCard(await resolveHelpBackendCard(deps, action.actorId));
      case "help_turns":
        return rawCard(await resolveHelpTurnCard(deps, action.chatId, action.actorId));
      case "help_merge": {
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
        const actionValue = (((action.raw as CardActionData)?.action?.value ?? {}) as Record<string, unknown>);
        if (!checkHelpCardOwner(actionValue, action.actorId)) {
          const ownerId = String(actionValue.ownerId ?? "");
          if (ownerId) {
            const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
            await notify(deps, action.chatId, GUARD.NOT_YOUR_CARD);
            return;
          }
        }
        return rawCard(await resolveHelpMergeCard(deps, action.chatId, action.actorId));
      }
    }
  },
  helpThreadNew: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_NEW");
    return rawCard(await resolveHelpThreadNewCard(deps, action.chatId, action.actorId));
  },
  helpSkillInstall: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_INSTALL");
    const actionValue = (((action.raw as CardActionData)?.action?.value ?? {}) as Record<string, unknown>);
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        await notify(deps, action.chatId, GUARD.NOT_YOUR_CARD);
        return;
      }
    }
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.skillName) return;
    const project = deps.findProjectByChatId(action.chatId);
    try {
      await deps.pluginService.install(action.skillName, project?.id, action.actorId);
    } catch (error) {
      await notify(deps, action.chatId, ERR.skillInstall(error instanceof Error ? error.message : String(error)));
    }
    return rawCard(await resolveHelpSkillCard(deps, action.chatId, action.actorId));
  },
  helpSkillRemove: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_REMOVE");
    const actionValue = (((action.raw as CardActionData)?.action?.value ?? {}) as Record<string, unknown>);
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        await notify(deps, action.chatId, GUARD.NOT_YOUR_CARD);
        return;
      }
    }
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.name) return;
    const project = deps.findProjectByChatId(action.chatId);
    try {
      if (project?.id) {
        await deps.pluginService.unbindFromProject?.(project.id, action.name);
      } else {
        await deps.pluginService.remove(action.name);
      }
    } catch (error) {
      await notify(deps, action.chatId, ERR.skillRemove(error instanceof Error ? error.message : String(error)));
    }
    return rawCard(await resolveHelpSkillCard(deps, action.chatId, action.actorId));
  },
  mergeConfirm: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    return handleMergeAction(deps, action.chatId, "confirm_merge", { branchName: action.branchName }, {
      userId: action.actorId,
    });
  },
  mergeCancel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    return handleMergeAction(deps, action.chatId, "cancel_merge", {
      branchName: action.branchName,
      baseBranch: action.baseBranch
    }, {
      userId: action.actorId,
    });
  },
  mergeReviewCancel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    await deps.orchestrator.cancelMergeReview(action.chatId, action.branchName, { userId: action.actorId });
    return rawCard({
      schema: "2.0",
      config: { width_mode: "fill", update_multi: true },
      header: {
        title: { tag: "plain_text", content: s.mergeReviewCanceledTitle(action.branchName) },
        subtitle: { tag: "plain_text", content: s.branchUnchanged },
        template: "grey"
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "4px 12px 12px 12px",
        elements: [{
          tag: "markdown",
          content: s.mergeReviewCanceledBody(action.branchName, action.baseBranch)
        },
        { tag: "hr" },
        {
          tag: "interactive_container",
          width: "fill",
          height: "auto",
          has_border: true,
          border_color: "grey",
          corner_radius: "8px",
          padding: "10px 12px 10px 12px",
          behaviors: [{ type: "callback", value: { action: "help_merge", ownerId: action.actorId, branchName: action.branchName } }],
          elements: [{
            tag: "markdown",
            content: s.backToMergePanel,
            icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
          }]
        }]
      }
    });
  },
  mergeReviewStart: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    return startMergeReviewFlow(deps, {
      chatId: action.chatId,
      operatorId: action.actorId,
      messageId: String(payload.context?.open_message_id ?? ""),
      actionValue: {
        ...actionValue,
        branchName: action.branchName,
        baseBranch: action.baseBranch ?? actionValue.baseBranch
      }
    }, action.branchName);
  },
  mergePreview: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        await notify(deps, action.chatId, GUARD.NOT_YOUR_CARD);
        return;
      }
    }
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const preview = await deps.orchestrator.handleMergePreview(action.chatId, action.branchName, {
        userId: action.actorId || undefined,
        traceId: String(payload.context?.open_message_id ?? "") || undefined,
        threadId: typeof actionValue.threadId === "string" ? actionValue.threadId : undefined,
        turnId: typeof actionValue.turnId === "string" ? actionValue.turnId : undefined,
      });
      if (!preview.canMerge) {
        return startMergeReviewFlow(deps, {
          chatId: action.chatId,
          operatorId: action.actorId,
          messageId: String(payload.context?.open_message_id ?? ""),
          actionValue,
        }, action.branchName);
      }
      const diffStats = preview.diffStats ?? { additions: 0, deletions: 0, filesChanged: [] };
      const baseBranch = typeof (preview as { baseBranch?: unknown }).baseBranch === "string"
        ? (preview as { baseBranch: string }).baseBranch
        : "main";
      return rawCard(deps.platformOutput.buildMergePreviewCard(
        action.chatId,
        action.branchName,
        baseBranch,
        diffStats,
        preview.canMerge,
        preview.conflicts,
        undefined,
        action.actorId
      ));
    } catch (error) {
      await notify(deps, action.chatId, ERR.mergePreview(error instanceof Error ? error.message : String(error)));
      return;
    }
  },
  mergeRetryFile: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const formValues = (payload.action as Record<string, unknown>)?.form_value as Record<string, string> | undefined;
    const feedback = formValues?.merge_feedback?.trim() || "";
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName || !action.filePath) return;
    try {
      const review = await deps.orchestrator.retryMergeFile(action.chatId, action.branchName, action.filePath, feedback, {
        userId: action.actorId || undefined,
        traceId: String(payload.context?.open_message_id ?? "") || undefined,
        threadId: typeof payload.action?.value?.threadId === "string" ? payload.action.value.threadId : undefined,
        turnId: typeof payload.action?.value?.turnId === "string" ? payload.action.value.turnId : undefined,
      });
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      await notify(deps, action.chatId, s.mergeRetrying(action.filePath));
      return rawCard(deps.platformOutput.buildFileReviewCard(review));
    } catch (error) {
      await notify(deps, action.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
      return;
    }
  },
  mergeReviewOpenFileDetail: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const review = await deps.orchestrator.getMergeReview(action.chatId, action.branchName);
      if (review.sessionState === "recovery_required") {
        return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
      }
      return rawCard(deps.platformOutput.buildMergeFileDetailCard(review));
    } catch (error) {
      await notify(deps, action.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
      return;
    }
  },
  mergeReviewBackOverview: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const review = await deps.orchestrator.getMergeReview(action.chatId, action.branchName);
      if (review.sessionState === "recovery_required") {
        return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
      }
      return rawCard(deps.platformOutput.buildFileReviewCard(review));
    } catch (error) {
      await notify(deps, action.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
      return;
    }
  },
  mergeReviewAgentAssistForm: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const review = await deps.orchestrator.getMergeReview(action.chatId, action.branchName);
      if (review.sessionState === "recovery_required") {
        return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
      }
      const backends = await deps.orchestrator.listAvailableBackends();
      return rawCard(deps.platformOutput.buildMergeAgentAssistCard(review, backends));
    } catch (error) {
      await notify(deps, action.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
      return;
    }
  },
  turnViewFileChanges: async (deps, action) => {
    const targetChatId = action.targetChatId?.trim() || action.chatId;
    const page = action.page ?? 0;
    const card = await resolveUnifiedTurnSubpage(
      deps,
      targetChatId,
      action.actorId,
      action.turnId,
      () => deps.platformOutput.renderFileChangesCard(targetChatId, action.turnId, page)
    );
    return card ? rawCard(card) : undefined;
  },
  turnFileChangesBack: async (deps, action) => {
    const targetChatId = action.targetChatId?.trim() || action.chatId;
    const card = await resolveUnifiedTurnCard(deps, targetChatId, action.actorId, action.turnId);
    return card ? rawCard(card) : undefined;
  },
  turnViewToolProgress: async (deps, action) => {
    const targetChatId = action.targetChatId?.trim() || action.chatId;
    const page = action.page ?? 0;
    const card = await resolveUnifiedTurnSubpage(
      deps,
      targetChatId,
      action.actorId,
      action.turnId,
      () => deps.platformOutput.renderToolProgressCard(targetChatId, action.turnId, page)
    );
    return card ? rawCard(card) : undefined;
  },
  turnToolProgressBack: async (deps, action) => {
    const targetChatId = action.targetChatId?.trim() || action.chatId;
    const card = await resolveUnifiedTurnCard(deps, targetChatId, action.actorId, action.turnId);
    return card ? rawCard(card) : undefined;
  },
  turnViewDetail: async (deps, action) => {
    const targetChatId = action.targetChatId?.trim() || action.chatId;
    const card = await resolveUnifiedTurnCard(deps, targetChatId, action.actorId, action.turnId);
    return card ? rawCard(card) : undefined;
  },
  snapshotJump: async (deps, action) => {
    return handleSnapshotAction(deps, action.chatId, action.actorId, {
      ...turnActionValue(undefined, action.turnId),
      threadId: action.threadId,
      ownerId: action.ownerId,
    });
  },
  mergeFileDecision: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const result = await deps.orchestrator.mergeDecideFile(
      action.chatId,
      action.branchName,
      action.filePath,
      action.decision,
      { userId: action.actorId }
    );
    if (result.kind === "file_merge_review") {
      return rawCard(deps.platformOutput.buildFileReviewCard(result));
    }
    return rawCard(deps.platformOutput.buildMergeSummaryCard(result));
  },
  mergeAcceptAll: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const summary = await deps.orchestrator.mergeAcceptAll(action.chatId, action.branchName, { userId: action.actorId });
    if (summary.kind === "file_merge_review") {
      return rawCard(deps.platformOutput.buildFileReviewCard(summary));
    }
    return rawCard(deps.platformOutput.buildMergeSummaryCard(summary));
  },
  mergeAgentAssist: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const review = await deps.orchestrator.resolveConflictsViaAgent(action.chatId, action.branchName, action.prompt, { userId: action.actorId });
    if (review.sessionState === "recovery_required") {
      return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
    }
    return rawCard(deps.platformOutput.buildFileReviewCard(review));
  },
  mergeCommit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const result = await deps.orchestrator.commitMergeReview(action.chatId, action.branchName, { userId: action.actorId });
    return rawCard(deps.platformOutput.buildMergeResultCard(action.branchName, "main", result.success, result.message));
  },
  adminUserToggle: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_ADD");
    if (!action.targetUserId) return;
    if (action.promote) {
      deps.userRepository.setAdmin(action.targetUserId, "im");
    } else {
      deps.userRepository.removeAdmin(action.targetUserId);
    }
    return rawCard(deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps)));
  },
  adminPanel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    switch (action.panel) {
      case "home":
        return rawCard(deps.platformOutput.buildAdminHelpCard());
      case "project":
        return rawCard(deps.platformOutput.buildAdminProjectCard(buildAdminProjectData(deps)));
      case "member":
        return rawCard(deps.platformOutput.buildAdminMemberCard(await buildAdminMemberData(deps)));
      case "user":
        return rawCard(deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps)));
      case "skill": {
        const data = await buildAdminSkillData(deps, action.chatId);
        return rawCard(deps.platformOutput.buildAdminSkillCard(data));
      }
      case "backend": {
        const data = await buildAdminBackendData(deps);
        const card = deps.platformOutput.buildAdminBackendCard(data);
        log.info({ cardSize: JSON.stringify(card).length, elementCount: (card as { body?: { elements?: unknown[] } }).body?.elements?.length }, "admin_panel_backend card built");
        return rawCard(card);
      }
    }
  },
  adminUserPage: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const card = deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps, Math.max(0, action.page)));
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    if (!messageId) return rawCard(card);
    await deps.feishuAdapter.updateInteractiveCard(messageId, card);
    return;
  },
  // ── Project Init / Bind ───────────────────────────────────────────────────
  initProject: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    const payload = action.raw as CardActionData;
    const actionValue = payload.action?.value ?? {};
    return handleInitProjectAction(deps, payload, action.chatId, action.actorId, actionValue);
  },
  initRootMenu: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    return rawCard(deps.platformOutput.buildInitCard(getUnboundProjects(deps)));
  },
  initBindMenu: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    return rawCard(deps.platformOutput.buildInitBindMenuCard(getUnboundProjects(deps)));
  },
  initCreateMenu: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    return rawCard(deps.platformOutput.buildInitCreateMenuCard());
  },
  initBindExisting: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    if (!action.projectId || !action.chatId) return;
    try {
      const result = await deps.projectSetupService.bindExistingProject(action.chatId, action.projectId, action.actorId);
      void pushProjectHelpCard(deps, action.chatId, action.actorId).catch((error) => {
        log.warn({ chatId: action.chatId, operatorId: action.actorId, err: error instanceof Error ? error.message : String(error) }, "send bind project help card failed");
      });
      return rawCard(deps.platformOutput.buildInitSuccessCard({
        projectName: result.projectName,
        id: result.projectId,
        cwd: result.cwd,
        gitUrl: result.gitUrl ?? "",
        operatorId: action.actorId
      }));
    } catch (err) {
      log.warn({ projectId: action.projectId, chatId: action.chatId, err }, "bind_existing_project failed");
    }
  },
  installSkill: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_INSTALL");
    const payload = action.raw as CardActionData;
    const actionValue = payload.action?.value ?? {};
    await handleSkillAction(deps, payload, action.chatId, actionValue);
    // A2: Refresh skill list card after install
    return rawCard(await resolveHelpSkillCard(deps, action.chatId, action.actorId));
  },

  // ── Admin Project ────────────────────────────────────────────────────────
  adminProjectEdit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    const state = deps.adminStateStore.read();
    const project = state.projects.find(p => p.id === action.projectId);
    if (!project) return;
    const card = deps.platformOutput.buildAdminProjectEditCard({
      id: project.id,
      name: project.name,
      gitUrl: project.gitUrl,
      chatId: project.chatId
    });
    return rawCard(alignButtonStyle(card, s.alignBackProjectManagement, s.alignSave));
  },
  adminProjectSave: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    const payload = action.raw as CardActionData;
    const formValues = (payload.action as Record<string, unknown>)?.form_value as Record<string, string> | undefined;
    const newName = formValues?.project_name?.trim();
    const newGitUrl = formValues?.git_url?.trim();
    const state = deps.adminStateStore.read();
    const project = state.projects.find(p => p.id === action.projectId);
    if (!project) return;
    if (newName && newName !== project.name) {
      if (state.projects.some(p => p.name === newName && p.id !== action.projectId)) {
        const card = deps.platformOutput.buildAdminProjectEditCard({
          id: project.id, name: project.name, gitUrl: project.gitUrl
        });
        return rawCard(alignButtonStyle(card, s.alignBackProjectManagement, s.alignSave));
      }
      project.name = newName;
    }
    if (newGitUrl !== undefined) {
      project.gitUrl = newGitUrl || undefined;
      if (newGitUrl && project.cwd) {
        try {
          await deps.projectSetupService.updateGitRemote(project.cwd, newGitUrl);
        } catch (err) {
          log.warn({ projectId: action.projectId, err }, "admin_project_save: updateGitRemote failed");
        }
      }
    }
    project.updatedAt = new Date().toISOString();
    deps.adminStateStore.write(state);
    log.info({ projectId: action.projectId, newName, newGitUrl }, "admin_project_save");
    return rawCard(deps.platformOutput.buildAdminProjectCard(buildAdminProjectData(deps)));
  },
  adminProjectToggle: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const state = deps.adminStateStore.read();
    const project = state.projects.find(p => p.id === action.projectId);
    if (!project) return;
    const wasActive = project.status === "active";
    project.status = wasActive ? "disabled" : "active";
    project.updatedAt = new Date().toISOString();
    deps.adminStateStore.write(state);
    if (wasActive && project.chatId) {
      await deps.orchestrator.onProjectDeactivated(project.chatId);
    }
    if (!wasActive && project.chatId) {
      const { recovered, failed, failures } = await deps.orchestrator.recoverSessions([project.id]);
      if (failed > 0) {
        throw new Error(`session recovery after re-enable failed for ${failed} thread(s): ${failures.map(item => `${item.projectId}/${item.threadName}[${item.category}]: ${item.reason}`).join("; ")}`);
      }
      log.info({ projectId: action.projectId, recovered, failed }, "session recovery after re-enable done");
    }
    log.info({ projectId: action.projectId, newStatus: project.status }, "admin_project_toggle");
    return rawCard(deps.platformOutput.buildAdminProjectCard(buildAdminProjectData(deps)));
  },
  adminProjectUnbind: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const result = await deps.projectSetupService.disableAndUnbindProjectById(action.projectId);
    if (!result) return;
    if (result.oldChatId) {
      await deps.orchestrator.onProjectDeactivated(result.oldChatId);
      try { await deps.feishuAdapter.leaveChat(result.oldChatId); } catch (error) {
        log.warn({ oldChatId: result.oldChatId, err: error instanceof Error ? error.message : String(error) }, "leaveChat after unbind failed");
      }
    }
    log.info({ projectId: action.projectId, oldChatId: result.oldChatId, newStatus: result.newStatus }, "admin_project_unbind");
    return rawCard(deps.platformOutput.buildAdminProjectCard(buildAdminProjectData(deps)));
  },
  adminProjectDelete: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const state = deps.adminStateStore.read();
    const idx = state.projects.findIndex(p => p.id === action.projectId);
    if (idx < 0) return;
    const project = state.projects[idx]!;
    const oldChatId = project.chatId;
    state.projects.splice(idx, 1);
    delete state.members[action.projectId];
    deps.adminStateStore.write(state);
    if (oldChatId) {
      await deps.orchestrator.onProjectDeactivated(oldChatId);
      try { await deps.feishuAdapter.leaveChat(oldChatId); } catch (error) {
        log.warn({ oldChatId, err: error instanceof Error ? error.message : String(error) }, "leaveChat after delete failed");
      }
    }
    log.info({ projectId: action.projectId, oldChatId }, "admin_project_delete");
    return rawCard(deps.platformOutput.buildAdminProjectCard(buildAdminProjectData(deps)));
  },
  adminProjectMembers: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const memberData = await buildAdminMemberData(deps);
    memberData.projects = memberData.projects.filter(p => p.projectId === action.projectId);
    return rawCard(deps.platformOutput.buildAdminMemberCard(memberData));
  },
  adminSearchProject: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    const keyword = String(payload.action?.form_value?.search_keyword ?? "").trim();
    const data = buildAdminProjectData(deps);
    if (keyword) data.projects = data.projects.filter(p => p.name.toLowerCase().includes(keyword.toLowerCase()));
    return rawCard(deps.platformOutput.buildAdminProjectCard(data, keyword || undefined));
  },
  adminSearchMember: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    const keyword = String(payload.action?.form_value?.search_keyword ?? "").trim();
    const data = await buildAdminMemberData(deps);
    if (keyword) data.projects = data.projects.filter(p => p.projectName.toLowerCase().includes(keyword.toLowerCase()));
    return rawCard(deps.platformOutput.buildAdminMemberCard(data, keyword || undefined));
  },
  adminSearchUser: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    const keyword = String(payload.action?.form_value?.search_keyword ?? "").trim();
    if (!keyword) {
      return rawCard(deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps)));
    }
    const allUsers = deps.userRepository.listAll({ limit: 10000 });
    const matchingIds: string[] = [];
    for (const u of allUsers.users) {
      const displayName = await deps.feishuAdapter.getUserDisplayName?.(u.userId) ?? u.userId;
      if (displayName.toLowerCase().includes(keyword.toLowerCase())) {
        matchingIds.push(u.userId);
      }
    }
    const { users, total } = deps.userRepository.listAll({ userIds: matchingIds, limit: USER_PAGE_SIZE });
    const enriched = await Promise.all(users.map(async u => ({
      userId: u.userId,
      displayName: await deps.feishuAdapter.getUserDisplayName?.(u.userId),
      sysRole: u.sysRole,
      source: u.source
    })));
    return rawCard(deps.platformOutput.buildAdminUserCard({
      kind: "admin_user", users: enriched, total, page: 0, pageSize: USER_PAGE_SIZE
    }, keyword));
  },

  // ── Admin Member / Role ──────────────────────────────────────────────────
  adminMemberRoleChange: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "USER_ROLE");
    const payload = action.raw as CardActionData;
    const newRole = String((payload.action as Record<string, unknown>)?.option ?? "");
    if (!action.targetUserId || !action.projectId || !["maintainer", "developer", "auditor"].includes(newRole)) {
      return rawCard(deps.platformOutput.buildAdminMemberCard(await buildAdminMemberData(deps)));
    }
    const state = deps.adminStateStore.read();
    const members = state.members[action.projectId] ?? [];
    const idx = members.findIndex(m => m.userId === action.targetUserId);
    if (idx >= 0) {
      members[idx] = { ...members[idx], role: newRole as "maintainer" | "developer" | "auditor" };
      state.members[action.projectId] = members;
      deps.adminStateStore.write(state);
      log.info({ targetUserId: action.targetUserId, projectId: action.projectId, newRole }, "admin_member_role_change");
    }
    return rawCard(deps.platformOutput.buildAdminMemberCard(await buildAdminMemberData(deps)));
  },
  helpRoleChange: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "USER_ROLE");
    const payload = action.raw as CardActionData;
    const newRole = String((payload.action as Record<string, unknown>)?.option ?? "");
    if (!action.targetUserId || !action.projectId || !["maintainer", "developer", "auditor"].includes(newRole)) {
      return;
    }
    const state = deps.adminStateStore.read();
    const members = state.members[action.projectId] ?? [];
    const idx = members.findIndex(m => m.userId === action.targetUserId);
    if (idx >= 0) {
      members[idx] = { ...members[idx], role: newRole as "maintainer" | "developer" | "auditor" };
      state.members[action.projectId] = members;
      deps.adminStateStore.write(state);
      log.info({ targetUserId: action.targetUserId, projectId: action.projectId, newRole }, "help_role_change");
    }
    const updatedMembers = (state.members[action.projectId] ?? []).map(m => ({
      userId: m.userId, role: m.role
    }));
    return rawCard(deps.platformOutput.buildHelpCard(action.actorId, {
      isAdmin: true, members: updatedMembers, projectId: action.projectId
    }));
  },

  // ── Admin Skill ──────────────────────────────────────────────────────────
  adminSkillInstallOpen: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    return rawCard(deps.platformOutput.buildAdminSkillInstallCard
      ? deps.platformOutput.buildAdminSkillInstallCard()
      : deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)));
  },
  adminSkillFileInstallOpen: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    return rawCard(deps.platformOutput.buildAdminSkillFileInstallCard
      ? deps.platformOutput.buildAdminSkillFileInstallCard()
      : deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)));
  },
  adminSkillInstallSubmit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    const actionValue = payload.action?.value ?? {};
    const messageId = String(payload.context?.open_message_id ?? "");
    return handleAdminSkillInstallSubmit(deps, payload, action.chatId, action.actorId, actionValue, messageId);
  },
  adminSkillFileInstallSubmit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    return handleAdminSkillFileInstallSubmit(deps, payload, action.chatId, action.actorId);
  },
  adminSkillFileInstallConfirm: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    return handleAdminSkillFileInstallConfirm(deps, payload, action.chatId, action.actorId);
  },
  adminSkillFileInstallCancel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    return handleAdminSkillFileInstallCancel(deps, action.chatId, action.actorId);
  },
  adminSkillBind: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const project = deps.findProjectByChatId(action.chatId);
    if (!action.pluginName || !project?.id) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      await notify(deps, action.chatId, s.enablePluginNoProject);
      return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)));
    }
    await deps.pluginService.bindToProject?.(project.id, action.pluginName, action.actorId);
    log.info({ chatId: action.chatId, projectId: project.id, pluginName: action.pluginName, operatorId: action.actorId }, "admin_skill_bind");
    return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)));
  },
  adminSkillUnbind: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const project = deps.findProjectByChatId(action.chatId);
    if (!action.pluginName || !project?.id) return;
    await deps.pluginService.unbindFromProject?.(project.id, action.pluginName);
    log.info({ chatId: action.chatId, projectId: project.id, pluginName: action.pluginName, operatorId: action.actorId }, "admin_skill_unbind");
    return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)));
  },

  // ── Admin Backend ────────────────────────────────────────────────────────
  adminBackendEdit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendEditCard(data, action.backend));
  },
  adminBackendPolicyEdit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendPolicyCard(data, action.backend));
  },
  adminBackendPolicySave: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend) return;
    const payload = action.raw as CardActionData;
    const formValues = payload.action?.form_value ?? {};
    const messageId = String(payload.context?.open_message_id ?? "");
    log.info({ backendId: action.backend, chatId: action.chatId, traceId: messageId || undefined }, "admin_backend_policy_save");
    if (action.backend === "codex") {
      if (formValues.approval_policy) deps.orchestrator.updateBackendPolicy(action.backend, "approval_policy", String(formValues.approval_policy), { chatId: action.chatId, traceId: messageId || undefined, userId: action.actorId });
      if (formValues.sandbox_mode) deps.orchestrator.updateBackendPolicy(action.backend, "sandbox_mode", String(formValues.sandbox_mode), { chatId: action.chatId, traceId: messageId || undefined, userId: action.actorId });
    } else if (action.backend === "opencode") {
      if (formValues.permission_question) deps.orchestrator.updateBackendPolicy(action.backend, "permission_question", String(formValues.permission_question), { chatId: action.chatId, traceId: messageId || undefined, userId: action.actorId });
    } else if (action.backend === "claude-code") {
      if (formValues.defaultMode) deps.orchestrator.updateBackendPolicy(action.backend, "defaultMode", String(formValues.defaultMode), { chatId: action.chatId, traceId: messageId || undefined, userId: action.actorId });
    }
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendEditCard(data, action.backend));
  },
  adminBackendAddProviderForm: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendAddProviderCard(data, action.backend));
  },
  adminBackendAddProvider: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend) return;
    const payload = action.raw as CardActionData;
    const formValues = payload.action?.form_value ?? {};
    const messageId = String(payload.context?.open_message_id ?? "");
    const providerName = String(Object.entries(formValues).find(([k]) => k.startsWith("pn"))?.[1] ?? "").trim();
    const baseUrl = String(Object.entries(formValues).find(([k]) => k.startsWith("pu"))?.[1] ?? "").trim() || undefined;
    const apiKeyEnv = String(Object.entries(formValues).find(([k]) => k.startsWith("pk"))?.[1] ?? "").trim() || undefined;
    if (!providerName) return;
    log.info({ backendId: action.backend, providerName, baseUrl, apiKeyEnv, chatId: action.chatId, traceId: messageId }, "admin_backend_add_source");
    await deps.orchestrator.adminAddProvider(action.backend, providerName, baseUrl, apiKeyEnv, {
      chatId: action.chatId,
      traceId: messageId,
      userId: action.actorId
    });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendEditCard(data, action.backend));
  },
  adminBackendRemoveProvider: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider) return;
    await deps.orchestrator.adminRemoveProvider(action.backend, action.provider);
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendEditCard(data, action.backend));
  },
  adminBackendModelManage: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendValidateModel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider) return;
    const payload = action.raw as CardActionData;
    const formValues = payload.action?.form_value ?? {};
    const rawInput = String(Object.entries(formValues).find(([k]) => k.startsWith("mn_"))?.[1] ?? "").trim();
    if (!rawInput) return;

    let modelName: string;
    let modelConfig: Record<string, unknown> | undefined;
    function tryParseJson(input: string): Record<string, unknown> | null {
      try {
        const parsed = JSON.parse(input);
        return typeof parsed === "object" && parsed !== null ? parsed : null;
      } catch { return null; }
    }
    let parsed = tryParseJson(rawInput) ?? tryParseJson(`{${rawInput}}`);
    if (parsed) {
      const keys = Object.keys(parsed);
      if (keys.length === 1 && typeof parsed[keys[0]!] === "object") {
        modelName = keys[0]!;
        modelConfig = parsed[keys[0]!] as Record<string, unknown>;
      } else {
        modelName = (parsed as any).name ?? rawInput;
        modelConfig = parsed;
      }
    } else {
      modelName = rawInput;
    }

    const messageId = String(payload.context?.open_message_id ?? "");
    log.info({ backendId: action.backend, providerName: action.provider, modelName, hasConfig: !!modelConfig, chatId: action.chatId, traceId: messageId }, "admin_backend_add_model");
    await deps.orchestrator.adminAddModel(action.backend, action.provider, modelName, modelConfig, {
      chatId: action.chatId,
      traceId: messageId,
      userId: action.actorId
    });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendRemoveModel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider || !action.model) return;
    await deps.orchestrator.adminRemoveModel(action.backend, action.provider, action.model);
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendRecheck: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider) return;
    log.info({ backendId: action.backend, providerName: action.provider, chatId: action.chatId }, "admin_backend_recheck");
    await deps.orchestrator.adminTriggerRecheck(action.backend, action.provider, { chatId: action.chatId });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendAddProfile: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend) return;
    const payload = action.raw as CardActionData;
    const formValues = payload.action?.form_value ?? {};
    const messageId = String(payload.context?.open_message_id ?? "");
    const profileName = String(formValues.profile_name ?? "").trim();
    const profileModel = String(formValues.profile_model ?? "").trim();
    if (!profileName || !profileModel) return;
    const providerFromForm = String(formValues.profile_provider ?? "").trim();
    const configs = await deps.orchestrator.readBackendConfigs();
    const b = configs.find(c => c.name === action.backend);
    const providerName = providerFromForm || (b?.activeProvider ?? b?.providers[0]?.name ?? action.backend);

    const extras: Record<string, unknown> = {};
    if (action.backend === "codex") {
      if (formValues.model_reasoning_effort) extras.model_reasoning_effort = String(formValues.model_reasoning_effort);
      if (formValues.personality) extras.personality = String(formValues.personality);
    } else if (action.backend === "opencode") {
      if (formValues.thinking_budget_tokens) extras.thinking_budget_tokens = Number(formValues.thinking_budget_tokens);
      if (formValues.context_limit) extras.context_limit = Number(formValues.context_limit);
      if (formValues.output_limit) extras.output_limit = Number(formValues.output_limit);
      const modInput = Array.isArray(formValues.modalities_input) ? formValues.modalities_input : [];
      const modOutput = Array.isArray(formValues.modalities_output) ? formValues.modalities_output : [];
      if (modInput.length > 0 || modOutput.length > 0) {
        extras.modalities = { input: modInput, output: modOutput };
      }
    }

    deps.orchestrator.adminWriteProfile(action.backend, profileName, profileModel, providerName, extras, {
      chatId: action.chatId,
      traceId: messageId || undefined,
      userId: action.actorId
    });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendRemoveProfile: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.profileName) return;
    deps.orchestrator.adminDeleteProfile(action.backend, action.profileName);
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
});

async function authorizeFeishuCardIntent(
  deps: FeishuHandlerDeps,
  chatId: string,
  operatorId: string,
  intent: IntentType
): Promise<void> {
  const project = deps.findProjectByChatId(chatId);
  const role = deps.roleResolver.resolve(operatorId, project?.id, { autoRegister: true });
  authorizeIntent(role, intent);
}

async function resolveUnifiedTurnCard(deps: FeishuHandlerDeps, chatId: string, operatorId: string, turnId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const recovery = await deps.orchestrator.getTurnDetail(chatId, turnId);
    return deps.platformOutput.primeHistoricalTurnCard({
      chatId,
      turnId: recovery.record.turnId,
      threadName: recovery.record.threadName,
      backendName: recovery.detail.backendName,
      modelName: recovery.detail.modelName,
      thinking: recovery.detail.reasoning,
      message: recovery.detail.message ?? recovery.record.lastAgentMessage,
      tools: recovery.detail.tools,
      fileChanges: recovery.record.diffSummary
        ? [{
          filesChanged: recovery.record.filesChanged ?? [],
          diffSummary: recovery.record.diffSummary,
          stats: recovery.record.stats
        }]
        : [],
      toolOutputs: recovery.detail.toolOutputs,
      planState: recovery.detail.planState,
      tokenUsage: recovery.record.tokenUsage,
      promptSummary: recovery.detail.promptSummary,
      agentNote: recovery.detail.agentNote,
      actionTaken: recovery.record.status === "accepted" || recovery.record.status === "reverted" || recovery.record.status === "interrupted"
        ? recovery.record.status
        : undefined,
      turnMode: recovery.detail.turnMode
    });
  } catch (error) {
    if (error instanceof OrchestratorError && (error.code === ErrorCode.TURN_RECORD_MISSING || error.code === ErrorCode.TURN_DETAIL_MISSING)) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      const projectId = String(error.meta?.projectId ?? deps.findProjectByChatId(chatId)?.id ?? "unknown");
      const label = error.code === ErrorCode.TURN_DETAIL_MISSING ? s.turnDetailMissing : s.turnRecordMissing;
      log.error({ chatId, turnId, projectId, operatorId, code: error.code }, "resolveUnifiedTurnCard failed");
      throw new TurnRecoveryError(
        s.turnRecoveryFailed(label, turnId, projectId, chatId),
        { turnId, projectId, chatId }
      );
    }
    throw error;
  }
}

async function resolveUnifiedTurnSubpage(
  deps: FeishuHandlerDeps,
  chatId: string,
  operatorId: string,
  turnId: string,
  render: () => Record<string, unknown> | null
): Promise<Record<string, unknown> | undefined> {
  const direct = render();
  if (direct) return direct;
  await resolveUnifiedTurnCard(deps, chatId, operatorId, turnId);
  return render() ?? undefined;
}

function resolveTurnChatId(actionValue: Record<string, unknown>, defaultChatId: string): string {
  const raw = typeof actionValue.chatId === "string" ? actionValue.chatId.trim() : "";
  return raw || defaultChatId;
}

function turnActionValue(targetChatId: string | undefined, turnId: string): Record<string, unknown> {
  const value: Record<string, unknown> = { turnId };
  if (targetChatId) value.chatId = targetChatId;
  return value;
}

function greyTip(content: string): Record<string, unknown> {
  return {
    tag: "div",
    text: { tag: "plain_text", content, text_size: "notation", text_color: "grey" }
  };
}

function parseBackendModelSelection(raw: string): { backendId: string; model: string } {
  const value = raw.trim();
  const colonIdx = value.indexOf(":");
  if (colonIdx < 0) {
    return { backendId: value, model: "" };
  }
  return {
    backendId: value.slice(0, colonIdx),
    model: value.slice(colonIdx + 1),
  };
}

async function pushProjectHelpCard(
  deps: FeishuHandlerDeps,
  chatId: string,
  operatorId: string
): Promise<void> {
  const helpCard = await resolveHelpCard(deps, chatId, operatorId);
  await deps.feishuAdapter.sendInteractiveCard(chatId, helpCard);
}

function getUnboundProjects(deps: FeishuHandlerDeps): Array<{ id: string; name: string; cwd: string; gitUrl?: string }> {
  const state = deps.adminStateStore.read();
  return state.projects
    .filter(project => !project.chatId)
    .map(project => ({
      id: project.id,
      name: project.name,
      cwd: project.cwd,
      gitUrl: project.gitUrl
    }));
}

function mergeActionContext(ctx: { chatId: string; operatorId: string; messageId?: string; actionValue: Record<string, unknown> }) {
  return {
    chatId: ctx.chatId,
    userId: ctx.operatorId || undefined,
    traceId: ctx.messageId || undefined,
    threadId: typeof ctx.actionValue.threadId === "string" ? ctx.actionValue.threadId : undefined,
    turnId: typeof ctx.actionValue.turnId === "string" ? ctx.actionValue.turnId : undefined,
  };
}

async function startMergeReviewFlow(
  deps: FeishuHandlerDeps,
  ctx: { chatId: string; operatorId: string; messageId?: string; actionValue: Record<string, unknown> },
  branchName: string
): Promise<CardActionResponse> {
  const context = mergeActionContext(ctx);
  const review = await deps.orchestrator.startMergeReview(ctx.chatId, branchName, context);
  if (review.sessionState === "recovery_required") {
    return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
  }
  return rawCard(deps.platformOutput.buildFileReviewCard(review));
}

function readButtonText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const text = (node as { text?: unknown }).text;
  if (typeof text === "string") return text;
  if (text && typeof text === "object") {
    const content = (text as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }
  const content = (node as { content?: unknown }).content;
  return typeof content === "string" ? content : "";
}

function collectButtonsByText(node: unknown, acc: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  if (Array.isArray(node)) {
    for (const item of node) collectButtonsByText(item, acc);
    return acc;
  }
  if (!node || typeof node !== "object") return acc;

  const obj = node as Record<string, unknown>;
  if (obj.tag === "button") acc.push(obj);

  for (const value of Object.values(obj)) collectButtonsByText(value, acc);
  return acc;
}

function alignButtonStyle(card: Record<string, unknown>, sourceText: string, targetText: string): Record<string, unknown> {
  const buttons = collectButtonsByText(card);
  const source = buttons.find(btn => readButtonText(btn).includes(sourceText));
  const target = buttons.find(btn => readButtonText(btn).includes(targetText));
  if (!source || !target) return card;

  for (const key of ["type", "style", "size", "width", "disabled"]) {
    if (key in source) {
      target[key] = source[key];
    } else {
      delete target[key];
    }
  }
  return card;
}

/**
 * Layer 1: 输入消毒 — 将用户输入的相对路径消毒并拼接为绝对路径。
 * 七条规则独立于 Layer 2（project-setup-service）做快速拒绝。
 */
function sanitizeProjectPath(
  rawInput: string,
  projectName: string,
  workspace: string,
  locale: "zh-CN" | "en-US"
): { absolute: string; relative: string } {
  const s = getFeishuCardHandlerStrings(locale);
  // R1: 空值 → 使用 projectName 作为子目录
  let rel = rawInput.trim() || projectName;

  // R2: 禁止空字节（NUL injection）
  if (rel.includes('\0')) throw new Error(s.invalidPathChars);

  // R3: 标准化路径分隔符
  rel = rel.replace(/\\/g, '/');

  // R4: 禁止绝对路径
  if (rel.startsWith('/')) throw new Error(s.relativePathRequired);

  // R5: 禁止 .. 组件（逐段检查）
  const segments = rel.split('/').filter(Boolean);
  if (segments.length === 0) throw new Error(s.pathEmpty);
  if (segments.some(s => s === '..')) throw new Error(s.pathParentNotAllowed);

  // R6: 字符白名单（字母数字 中文 _ - . /）
  if (!/^[\w\u4e00-\u9fff.\/-]+$/.test(rel)) throw new Error(s.pathWhitelistError);

  // R7: 长度限制
  if (rel.length > 200) throw new Error(s.pathTooLong);

  return { absolute: pathJoin(workspace, rel), relative: rel };
}

async function handleInitProjectAction(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  operatorId: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const formValues = payload.action?.form_value;
  const projectName = String(formValues?.project_name ?? actionValue.project_name ?? "").trim() || `project-${Date.now()}`;
  const rawCwd = String(formValues?.project_cwd ?? actionValue.project_cwd ?? "").trim();
  const gitUrl = String(formValues?.git_url ?? actionValue.git_url ?? "").trim();
  const gitToken = String(formValues?.git_token ?? actionValue.git_token ?? "").trim();

  let sanitized: { absolute: string; relative: string };
  try {
    sanitized = sanitizeProjectPath(rawCwd, projectName, deps.config.cwd, deps.config.locale);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await notify(deps, chatId, ERR.pathValidation(msg));
    return;
  }

  try {
    const result = await deps.projectSetupService.setupFromInitCard({
      chatId,
      projectName,
      projectCwd: sanitized.absolute,
      gitUrl: gitUrl || undefined,
      gitToken: gitToken || undefined,
      ownerId: operatorId
    });
    const displayName = await deps.feishuAdapter.getUserDisplayName?.(operatorId);
    const successCard = deps.platformOutput.buildInitSuccessCard({
      projectName: result.projectName,
      id: result.projectId,
      cwd: sanitized.relative,
      gitUrl: result.gitUrl ?? "",
      operatorId: result.ownerId,
      displayName
    });
    const msgToken = String(payload.context?.open_message_id ?? "");
    if (msgToken) {
      deps.feishuAdapter.pinMessage?.(msgToken).catch((error) => {
        log.warn({ chatId, messageId: msgToken, err: error instanceof Error ? error.message : String(error) }, "pin init project message failed");
      });
    }
    log.info({ projectId: result.projectId, cwd: result.cwd }, "init_project created");
    void pushProjectHelpCard(deps, chatId, operatorId).catch((error) => {
      log.warn({ chatId, operatorId, err: error instanceof Error ? error.message : String(error) }, "send init project help card failed");
    });

    // 批量注册群内现有成员为 auditor（异步，不阻塞返回）
    deps.feishuAdapter.listChatMembers?.(chatId).then(memberIds => {
      if (!memberIds?.length) return;
      for (const uid of memberIds) {
        deps.roleResolver.autoRegister(uid, result.projectId);
      }
      log.info({ projectId: result.projectId, count: memberIds.length }, "bulk-registered existing chat members");
    }).catch(err => {
      log.warn({ projectId: result.projectId, err: err instanceof Error ? err.message : String(err) }, "bulk member registration failed");
    });

    return rawCard(successCard);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await notify(deps, chatId, ERR.projectCreate(msg));
    return;
  }
}

async function handleCreateThreadAction(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  operatorId: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const formValues = payload.action?.form_value;
  const messageId = String(payload.context?.open_message_id ?? "").trim();
  const threadName = String(formValues?.thread_name ?? actionValue.thread_name ?? "").trim() || `thread-${Date.now()}`;
  // Parse combined "backend:model" value from single selector
  const backendModelRaw = String(formValues?.backend_model ?? actionValue.backend_model ?? "").trim();
  const colonIdx = backendModelRaw.indexOf(":");
  const selectedBackend = colonIdx >= 0 ? backendModelRaw.slice(0, colonIdx) : backendModelRaw;
  const afterColon = colonIdx >= 0 ? backendModelRaw.slice(colonIdx + 1) : "";
  // If format is "backend:profile:model", split further
  const secondColon = afterColon.indexOf(":");
  const selectedProfile = secondColon >= 0 ? afterColon.slice(0, secondColon) : "";
  const selectedModel = secondColon >= 0 ? afterColon.slice(secondColon + 1) : afterColon;

  try {
    const project = deps.findProjectByChatId(chatId);
    const projectId = project?.id ?? "default-project";

    // Resolve serverCmd from backend definition if needed
    let serverCmd: string | undefined;
    if (selectedBackend) {
      const resolved = await deps.orchestrator.resolveBackend(selectedBackend);
      if (resolved) {
        serverCmd = resolved.serverCmd;
      }
    }

    // Validate backendId
    const backendId = isBackendId(selectedBackend) ? selectedBackend : "codex";
    const model = selectedModel || "gpt-5-codex";
    const createOpts = { backendId, model, serverCmd, profileName: selectedProfile || undefined };

    void deps.orchestrator.createThread(projectId, chatId, operatorId, threadName, createOpts)
      .then((created) => {
        log.info({ threadId: created.threadId, threadName, backend: backendId, model }, "create_thread (async)");
        if (messageId) {
          return resolveHelpThreadCard(deps, chatId, operatorId)
            .then((threadCard) => deps.feishuAdapter.updateInteractiveCard(messageId, threadCard));
        }
        return notify(
          deps,
          chatId,
          s.threadCreated(threadName, backendId, model, created.threadId.slice(0, 12))
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ threadName, backend: backendId, transport: transportFor(backendId), err: msg }, "create_thread async failed");
        if (messageId) {
          return deps.feishuAdapter.updateInteractiveCard(messageId, {
            schema: "2.0",
            config: { width_mode: "fill", update_multi: true },
            header: {
              title: { tag: "plain_text", content: s.creatingThreadFailedTitle(threadName) },
              subtitle: { tag: "plain_text", content: `${backendId} / ${model}` },
              template: "red"
            },
            body: {
              direction: "vertical",
              elements: [
                { tag: "markdown", content: s.creatingThreadFailedBody(msg) }
              ]
            }
          });
        }
        return notify(deps, chatId, ERR.threadCreate(msg));
      });

    return rawCard({
      schema: "2.0",
      header: {
        title: { tag: "plain_text", content: s.creatingThreadTitle(threadName) },
        subtitle: { tag: "plain_text", content: `${backendId} / ${model}` },
        template: "wathet"
      },
      body: {
        direction: "vertical",
        elements: [
          { tag: "markdown", content: s.creatingThreadBody(backendId) }
        ]
      }
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await notify(deps, chatId, ERR.threadCreate(msg));
    return;
  }
}

async function handleApprovalAction(
  deps: FeishuHandlerDeps,
  chatId: string,
  operatorId: string,
  action: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse | undefined> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const approvalId = String(actionValue.approvalId ?? actionValue.callId ?? "");
  if (!(action === "approve" || action === "deny" || action === "approve_always") || approvalId.length === 0) {
    return;
  }
  const project = deps.findProjectByChatId(chatId);
  if (!project?.id) {
    throw new Error(`approval action requires project binding for chatId=${chatId}`);
  }
  const threadId = typeof actionValue.threadId === "string" ? actionValue.threadId : "";
  if (!threadId) {
    throw new Error(`approval action requires threadId for approvalId=${approvalId}`);
  }
  const turnId = typeof actionValue.turnId === "string" ? actionValue.turnId : "";
  if (!turnId) {
    throw new Error(`approval action requires turnId for approvalId=${approvalId}`);
  }
  const approvalType = actionValue.approvalType;
  if (approvalType !== "command_exec" && approvalType !== "file_change") {
    throw new Error(`approval action requires valid approvalType for approvalId=${approvalId}`);
  }
  await deps.approvalHandler.handle({
    approvalId,
    approverId: operatorId || "unknown-approver",
    action,
    projectId: project.id,
    threadId,
    turnId,
    approvalType
  }, true);

  // Build updated card without buttons, showing who acted and when
  const actionLabel = action === "approve" ? s.approvalApproved : action === "deny" ? s.approvalRejected : s.approvalApprovedOnce;
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  const commandSummary = typeof actionValue.commandSummary === "string" ? actionValue.commandSummary
    : typeof actionValue.description === "string" ? actionValue.description  // backward compat
    : "";
  const threadLabel = typeof actionValue.threadLabel === "string" ? actionValue.threadLabel : (typeof actionValue.threadId === "string" ? actionValue.threadId : "");
  const createdAtLabel = typeof actionValue.createdAtLabel === "string" ? actionValue.createdAtLabel : "";
  const approvalTitle = typeof actionValue.approvalTitle === "string"
    ? actionValue.approvalTitle
    : (actionValue.approvalType === "file_change" ? s.approvalTitleFileChange : s.approvalTitleCommand);
  const approvalTypeLabel = typeof actionValue.approvalTypeLabel === "string"
    ? actionValue.approvalTypeLabel
    : (actionValue.approvalType === "file_change" ? s.approvalTypeFileChange : s.approvalTypeCommand);

  return rawCard({
    schema: "2.0",
    header: {
      title: { tag: "plain_text", content: approvalTitle },
      subtitle: { tag: "plain_text", content: [threadLabel, createdAtLabel].filter(Boolean).join(" · ") },
      icon: {
        tag: "standard_icon",
        token: actionValue.approvalType === "file_change" ? "file-detail_outlined" : "safe_outlined",
        color: action === "deny" ? "red" : "green"
      },
      text_tag_list: [
        { tag: "text_tag", text: { tag: "plain_text", content: actionLabel.replace(/[✅❌]\s*/, "") }, color: action === "deny" ? "red" : "green" },
        { tag: "text_tag", text: { tag: "plain_text", content: approvalTypeLabel }, color: "neutral" }
      ],
      template: action === "deny" ? "red" : "green"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [
        ...(commandSummary ? [
          { tag: "markdown", content: `${s.approvalSummaryTitle}\n> ${commandSummary.replace(/\n/g, "\n> ")}` },
          { tag: "hr" }
        ] : []),
        { tag: "markdown", content: `${s.approvalResultTitle}\n${actionLabel}  ·  <at id=${operatorId}></at>` },
        greyTip(s.approvalHandledAt(timeStr)),
        greyTip(s.approvalHandledNote)
      ]
    }
  });
}

// ── Help card owner check ────────────────────────────────────────────────────

function checkHelpCardOwner(actionValue: Record<string, unknown>, operatorId: string): boolean {
  const ownerId = String(actionValue.ownerId ?? "");
  return !ownerId || ownerId === operatorId;
}

async function handleThreadSwitchAction(
  deps: FeishuHandlerDeps,
  chatId: string,
  userId: string,
  action: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const { GUARD, ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const ownerId = String(actionValue.ownerId ?? "");
  if (ownerId && ownerId !== userId) {
    await notify(deps, chatId, GUARD.NOT_YOUR_CARD);
    return;
  }

  try {
    if (action === "switch_thread") {
      const threadName = String(actionValue.threadName ?? "");
      if (!threadName) {
        return;
      }
      // Update binding — pool is keyed by threadName, no release needed
      await deps.orchestrator.handleThreadJoin(chatId, userId, threadName);
      const activeBinding = await deps.orchestrator.getUserActiveThread(chatId, userId);
      const threads = await deps.orchestrator.handleThreadListEntries(chatId);
      const displayName = await deps.feishuAdapter.getUserDisplayName?.(userId);
      return rawCard(deps.platformOutput.buildThreadListCard(
        threads.map((thread) => ({
          threadName: thread.threadName,
          threadId: thread.threadId,
          status: thread.status,
          backendName: thread.backendId,
          modelName: thread.model,
          active: thread.status === "active" && activeBinding?.threadId === thread.threadId
        })),
        userId,
        displayName,
        false
      ));
    }

    // switch_to_main: leave thread, keep old thread's API alive
    await deps.orchestrator.handleThreadLeave(chatId, userId);
    log.info("switch_to_main: binding cleared, threads stay alive");
    const threads = await deps.orchestrator.handleThreadListEntries(chatId);
    const displayName = await deps.feishuAdapter.getUserDisplayName?.(userId);
    return rawCard(deps.platformOutput.buildThreadListCard(
      threads.map((thread) => ({
        threadName: thread.threadName,
        threadId: thread.threadId,
        status: thread.status,
        backendName: thread.backendId,
        modelName: thread.model,
        active: false
      })),
      userId,
      displayName,
      true
    ));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await notify(deps, chatId, ERR.switchFailed(msg));
    return;
  }
}

async function handleMergeAction(
  deps: FeishuHandlerDeps,
  chatId: string,
  action: string,
  actionValue: Record<string, unknown>,
  context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string }
): Promise<CardActionResponse> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const branchName = String(actionValue.branchName ?? "");
  const baseBranch = String(actionValue.baseBranch ?? "main");
  if (action === "confirm_merge" && branchName) {
    try {
      const mergeResult = await deps.orchestrator.handleMergeConfirm(chatId, branchName, undefined, context);
      return rawCard(deps.platformOutput.buildMergeResultCard(branchName, baseBranch, mergeResult.success, mergeResult.message));
    } catch (error) {
      return rawCard(deps.platformOutput.buildMergeResultCard(
        branchName,
        baseBranch,
        false,
        error instanceof Error ? error.message : String(error)
      ));
    }
  }

  return rawCard({
    schema: "2.0",
    config: { width_mode: "fill" },
    header: {
      title: { tag: "plain_text", content: s.mergeCanceledTitle(branchName) },
      subtitle: { tag: "plain_text", content: s.branchUnchanged },
      template: "grey"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements: [{
        tag: "markdown",
        content: s.mergeCanceledBody(branchName)
      }]
    }
  });
}

async function handleSnapshotAction(
  deps: FeishuHandlerDeps,
  chatId: string,
  userId: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const { GUARD, ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const ownerId = String(actionValue.ownerId ?? "");
  if (ownerId && ownerId !== userId) {
    await notify(deps, chatId, GUARD.NOT_YOUR_CARD);
    return;
  }
  const turnId = String(actionValue.turnId ?? "");
  const threadId = String(actionValue.threadId ?? "");
  if (!turnId) {
    return;
  }
  try {
    const { snapshot, contextReset } = await deps.orchestrator.jumpToSnapshot(chatId, turnId, userId);
    if (contextReset) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      await notify(deps, chatId,
        s.snapshotContextReset(snapshot.turnIndex)
      );
    }
    const allSnapshots = await deps.orchestrator.listSnapshots(chatId, threadId || snapshot.threadId);
    const displayName = await deps.feishuAdapter.getUserDisplayName?.(userId);
    const effectiveThreadId = threadId || snapshot.threadId;
    const resolvedBinding = await deps.orchestrator.getUserActiveThread(chatId, userId);
    const threadName = effectiveThreadId === MAIN_THREAD_NAME ? "main" : (resolvedBinding?.threadName ?? effectiveThreadId);
    return rawCard(deps.platformOutput.buildSnapshotHistoryCard(
      allSnapshots.map((item) => ({
        turnId: item.turnId,
        turnIndex: item.turnIndex,
        agentSummary: item.agentSummary,
        filesChanged: item.filesChanged,
        createdAt: item.createdAt,
        isCurrent: item.turnId === turnId
      })),
      effectiveThreadId,
      userId,
      displayName,
      threadName
    ));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await notify(deps, chatId, ERR.jumpFailed(msg));
    return;
  }
}

async function handleSkillAction(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  actionValue: Record<string, unknown>
): Promise<void> {
  const formValues = payload.action?.form_value;
  const skillName = String(formValues?.skill_name ?? actionValue.skill_name ?? "");
  if (!skillName) {
    return;
  }
  log.info({ chatId, skillName }, "install_skill");
  try {
    const project = deps.findProjectByChatId(chatId);
    const def = await deps.pluginService.install(skillName, project?.id);
    await deps.platformOutput.sendSkillOperation(chatId, {
      kind: "skill_operation",
      action: "installed",
      skill: { name: def.name, description: def.description, installed: true }
    });
  } catch (error) {
    await deps.platformOutput.sendSkillOperation(chatId, {
      kind: "skill_operation",
      action: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// ── Admin Panel Handlers ───────────────────────────────────────────────────────

async function checkCommandAvailable(cmd: string): Promise<boolean> {
  // Extract the binary name (first word) from a potentially complex command
  const binary = cmd.split(/\s+/)[0] ?? cmd;
  try {
    await execFileAsync("which", [binary]);
    return true;
  } catch {
    return false;
  }
}

function buildAdminProjectData(deps: FeishuHandlerDeps): import("../../services/contracts/im/im-output").IMAdminProjectPanel {
  const state = deps.adminStateStore.read();
  const workspace = deps.config.cwd;
  return {
    kind: "admin_project",
    projects: state.projects.map((p) => {
      // 显示相对路径，不暴露 workspace 根
      const relativeCwd = p.cwd.startsWith(workspace)
        ? p.cwd.slice(workspace.length).replace(/^[\\/]/, "") || "."
        : p.cwd;
      return {
        id: p.id,
        name: p.name,
        chatId: p.chatId,
        cwd: relativeCwd,
        gitUrl: p.gitUrl,
        status: p.status,
        memberCount: state.members[p.id]?.length ?? 0
      };
    })
  };
}

async function buildAdminMemberData(deps: FeishuHandlerDeps): Promise<import("../../services/contracts/im/im-output").IMAdminMemberPanel> {
  const state = deps.adminStateStore.read();
  const projects = await Promise.all(state.projects.map(async p => {
    const rawMembers = state.members[p.id] ?? [];
    const members = await Promise.all(rawMembers.map(async m => ({
      userId: m.userId,
      displayName: await deps.feishuAdapter.getUserDisplayName?.(m.userId),
      role: m.role
    })));
    return {
      projectName: p.name,
      projectId: p.id,
      chatId: p.chatId,
      members
    };
  }));
  return { kind: "admin_member", projects };
}

const USER_PAGE_SIZE = 15;

async function buildAdminUserData(deps: FeishuHandlerDeps, page = 0): Promise<import("../../services/contracts/im/im-output").IMAdminUserPanel> {
  const { users, total } = deps.userRepository.listAll({ offset: page * USER_PAGE_SIZE, limit: USER_PAGE_SIZE });
  const enriched = await Promise.all(users.map(async u => ({
    userId: u.userId,
    displayName: await deps.feishuAdapter.getUserDisplayName?.(u.userId),
    sysRole: u.sysRole,
    source: u.source
  })));
  return {
    kind: "admin_user",
    users: enriched,
    total,
    page,
    pageSize: USER_PAGE_SIZE,
  };
}

async function buildAdminSkillData(
  deps: FeishuHandlerDeps,
  chatId?: string
): Promise<import("../../services/contracts/im/im-output").IMAdminSkillPanel> {
  const project = chatId ? deps.findProjectByChatId(chatId) : null;
  const projectId = project?.id;
  const catalogByName = new Map((deps.pluginService.listCatalog?.() ?? []).map((entry) => [entry.pluginName, entry]));
  const plugins: Array<{
    pluginName: string;
    sourceType: string;
    name: string;
    description: string;
    downloaded: boolean;
    enabled: boolean;
    mcpServers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>;
    addedBy?: string;
    downloadedAt?: string;
  }> = projectId
    ? await (deps.pluginService.listProjectPlugins?.(projectId) ?? [])
    : (await deps.pluginService.list()).map((plugin) => {
      const catalog = catalogByName.get(plugin.name);
      return {
        ...plugin,
        pluginName: plugin.name,
        sourceType: catalog?.sourceType ?? "github-subpath",
        downloaded: true,
        enabled: false,
        addedBy: catalog?.downloadedBy,
        downloadedAt: catalog?.downloadedAt,
      };
    });
  return {
    kind: "admin_skill",
    projectId,
    projectName: project?.name,
    installTasks: chatId ? (installTaskStore.get(chatId) ?? []) : [],
    plugins: plugins.map((plugin) => ({
      pluginName: plugin.pluginName,
      sourceType: plugin.sourceType,
      name: plugin.name,
      description: plugin.description,
      downloaded: plugin.downloaded,
      enabled: plugin.enabled,
      hasMcpServers: plugin.mcpServers.length > 0,
      addedBy: plugin.addedBy,
      downloadedAt: plugin.downloadedAt,
    }))
  };
}

async function buildAdminBackendData(deps: FeishuHandlerDeps): Promise<import("../../services/contracts/im/im-output").IMAdminBackendPanel> {
  const configs = await deps.orchestrator.readBackendConfigs();
  return {
    kind: "admin_backend",
    backends: configs.map((c) => ({
      name: c.name,
      serverCmd: c.serverCmd,
      cmdAvailable: c.cmdAvailable,
      configPath: c.localConfigPath,
      configExists: c.configExists,
      activeProvider: c.activeProvider,
      policy: c.policy,
      providers: c.providers.map((p) => ({
        name: p.name,
        baseUrl: p.baseUrl,
        apiKeyEnv: p.apiKeyEnv,
        apiKeySet: p.apiKeySet,
        isActive: p.isActive,
        models: p.models.map((m) => ({
          name: m.name,
          available: m.available,
          checkedAt: m.checkedAt,
          isCurrent: m.isCurrent
        }))
      })),
      // Derive profiles from unified providers[].models[]
      profiles: c.providers.flatMap((p) =>
        p.models.map((m) => ({ name: m.name, model: m.modelId, provider: p.name, extras: m.extras }))
      ),
    }))
  };
}

async function handleAdminSkillInstallSubmit(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  operatorId: string,
  actionValue: Record<string, unknown>,
  messageId?: string
): Promise<CardActionResponse> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const { OP } = getFeishuNotifyCatalog(deps.config.locale);
  const formValues = payload.action?.form_value ?? {};
  const source = String(formValues.skill_source ?? "").trim();
  const pluginName = String(formValues.skill_name ?? "").trim() || undefined;
  const installMode = String(actionValue.installMode ?? "github_subpath").trim();
  const skillSubpath = String(formValues.skill_subpath ?? "").trim();
  const autoEnable = String(formValues.skill_auto_enable ?? "catalog").trim();
  const taskId = `skill-install-${Date.now().toString(36)}`;
  const label = `${installMode}:${pluginName ?? source}`;

  if (!source) {
    await notify(deps, chatId, OP.SKILL_SOURCE_MISSING);
    return rawCard(deps.platformOutput.buildAdminSkillInstallCard
      ? deps.platformOutput.buildAdminSkillInstallCard()
      : deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
  }

  const project = deps.findProjectByChatId(chatId);
  addInstallTask(chatId, {
    taskId,
    label,
    status: "running",
    detail: s.installTaskDownloading
  });
  log.info({ chatId, operatorId, taskId, installMode, source, pluginName, skillSubpath, autoEnable }, "admin_skill_install_started");

  void (async () => {
    try {
      if (installMode !== "github_subpath") {
        throw new Error(s.githubSubpathOnly);
      }
      if (!skillSubpath) throw new Error(s.githubSubpathRequired);
      if (!deps.pluginService.importFromGithubSubpath) throw new Error(s.githubSubpathImportUnavailable);
      await deps.pluginService.importFromGithubSubpath({
        repoUrl: source,
        skillSubpath,
        pluginName,
        actorId: operatorId,
        autoEnableProjectId: autoEnable === "project" ? project?.id : undefined,
      });

      updateInstallTask(chatId, taskId, { status: "success", detail: s.installTaskDownloaded });
      log.info({ chatId, operatorId, taskId, installMode, source, pluginName }, "admin_skill_install_succeeded");
      const card = deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId));
      if (messageId) {
        await deps.feishuAdapter.updateInteractiveCard(messageId, card);
      } else {
        await deps.platformOutput.sendRawCard(chatId, card);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateInstallTask(chatId, taskId, { status: "failed", detail: msg });
      log.error({ chatId, operatorId, taskId, installMode, source, pluginName, err: msg }, "admin_skill_install_failed");
      const card = deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId));
      if (messageId) {
        await deps.feishuAdapter.updateInteractiveCard(messageId, card);
      } else {
        await deps.platformOutput.sendRawCard(chatId, card);
      }
    }
  })();

  return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
}

async function handleAdminSkillFileInstallSubmit(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  operatorId: string
): Promise<CardActionResponse> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const formValues = payload.action?.form_value ?? {};
  const autoEnable = String(formValues.skill_auto_enable ?? "catalog").trim();
  const project = deps.findProjectByChatId(chatId);
  armPendingFeishuSkillInstall({
    chatId,
    userId: operatorId,
    autoEnableProjectId: autoEnable === "project" ? project?.id : undefined,
    onExpire: () => {
      void notify(deps, chatId, s.skillUploadTimeout);
    },
  });
  await notify(deps, chatId, s.skillUploadWaiting);
  return rawCard(
    deps.platformOutput.buildAdminSkillFileInstallCard
      ? deps.platformOutput.buildAdminSkillFileInstallCard({ mode: "awaiting_upload" })
      : deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId))
  );
}

async function handleAdminSkillFileInstallConfirm(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  operatorId: string
): Promise<CardActionResponse> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const staged = peekStagedFeishuSkillInstall(chatId, operatorId);
  if (!staged) {
    await notify(deps, chatId, s.noPendingSkillInstall);
    return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
  }
  try {
    if (!deps.pluginService.installFromLocalSource) throw new Error(s.localSkillImportUnavailable);
    if (!deps.pluginService.validateSkillNameCandidate) throw new Error(s.skillNameValidationUnavailable);
    const formValues = payload.action?.form_value ?? {};
    const finalPluginName = String(formValues.skill_name ?? "").trim() || staged.pluginName;
    const validation = deps.pluginService.validateSkillNameCandidate(finalPluginName);
    if (!validation.ok || !validation.normalizedName) {
      return rawCard(
        deps.platformOutput.buildAdminSkillFileConfirmCard
          ? deps.platformOutput.buildAdminSkillFileConfirmCard({
            fileName: staged.originalName ?? staged.localPath,
            pluginName: finalPluginName,
            manifestName: staged.manifestName,
            manifestDescription: staged.manifestDescription,
            sourceLabel: s.feishuFileSourceLabel,
            autoEnableProject: Boolean(staged.autoEnableProjectId),
            projectName: staged.autoEnableProjectId ? deps.findProjectByChatId(chatId)?.name : undefined,
            expiresHint: s.skillInstallExpiresHint,
            validationError: validation.reason ?? s.invalidSkillName,
          })
          : deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId))
      );
    }
    consumeStagedFeishuSkillInstall(chatId, operatorId);
    await deps.pluginService.installFromLocalSource({
      localPath: staged.localPath,
      sourceLabel: `feishu-upload:${staged.originalName ?? staged.localPath}`,
      pluginName: validation.normalizedName,
      actorId: operatorId,
      autoEnableProjectId: staged.autoEnableProjectId,
    });
    await notify(deps, chatId, s.skillInstallCompleted(staged.originalName ?? staged.localPath));
  } catch (error) {
    await notify(deps, chatId, s.skillInstallFailed(error instanceof Error ? error.message : String(error)));
  } finally {
    await rm(staged.tempDir, { recursive: true, force: true }).catch((error) => {
      log.warn({ chatId, operatorId, err: error instanceof Error ? error.message : String(error) }, "staged skill temp dir cleanup failed");
    });
  }
  return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
}

async function handleAdminSkillFileInstallCancel(
  deps: FeishuHandlerDeps,
  chatId: string,
  operatorId: string
): Promise<CardActionResponse> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const staged = clearFeishuSkillInstallState(chatId, operatorId);
  if (staged?.tempDir) {
    await rm(staged.tempDir, { recursive: true, force: true }).catch((error) => {
      log.warn({ chatId, operatorId, err: error instanceof Error ? error.message : String(error) }, "cancelled skill temp dir cleanup failed");
    });
  }
  await notify(deps, chatId, s.skillInstallCanceled);
  return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
}


export async function handleFeishuCardAction(deps: FeishuHandlerDeps, data: Record<string, unknown>): Promise<CardActionResponse> {
  const action = feishuActionAdapter.toAction(data);
  if (!action) return;
  const payload = data as CardActionData;
  const actionValue = payload.action?.value ?? {};
  const actionId = String(actionValue.action ?? "");
  const operatorId = String(payload.operator?.open_id ?? "unknown-approver");
  const chatId = String(payload.context?.open_chat_id ?? "");
  const messageId = String(payload.context?.open_message_id ?? "");
  const actionLog = log.child({ chatId, userId: operatorId, messageId, action: actionId, traceId: messageId || undefined });
  const project = deps.findProjectByChatId(chatId);

  try {
    const result = await feishuActionRouter.route(deps, action);
    await deps.auditService?.append({
      projectId: project?.id ?? "unknown",
      actorId: operatorId,
      action: `card_action:${actionId}`,
      result: "ok",
      traceId: messageId || undefined,
      correlationId: messageId || undefined,
      detailJson: { chatId, actionKeys: Object.keys(actionValue), actionKind: action.kind }
    });
    return result;
  } catch (error) {
    const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
    if (error instanceof AuthorizationError) {
      await notify(deps, chatId, GUARD.NO_PERMISSION);
      actionLog.info({ actionKind: action.kind }, "card action authorization denied");
      return;
    }
    actionLog.error({ err: error instanceof Error ? error.message : error }, "card action error");
    if (error instanceof TurnRecoveryError) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      await notify(deps, chatId, s.genericError(error.message));
    }
    await deps.auditService?.append({
      projectId: project?.id ?? "unknown",
      actorId: operatorId,
      action: `card_action:${actionId}`,
      result: "error",
      traceId: messageId || undefined,
      correlationId: messageId || undefined,
      detailJson: { chatId, error: error instanceof Error ? error.message : String(error), actionKind: action.kind }
    });
    return;
  }
}
