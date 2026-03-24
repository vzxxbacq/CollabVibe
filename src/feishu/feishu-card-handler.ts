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
import type { CardActionResponse } from "../common/types";
import type { FeishuHandlerDeps } from "./types";
import { FeishuActionAdapter } from "./channel/index";
import { armPendingFeishuSkillInstall, clearFeishuSkillInstallState, consumeStagedFeishuSkillInstall, peekStagedFeishuSkillInstall } from "./skill-file-install-state";
import {
  sendProjectList, sendSnapshotList, sendModelList, sendThreadNewForm,
  resolveHelpCard, resolveHelpThreadCard, resolveHelpThreadNewCard, resolveHelpMergeCard,
  resolveSnapshotCard, resolveHelpSkillCard, resolveHelpBackendCard, resolveHelpTurnCard,
  resolveHelpProjectCard
} from "./shared-handlers";
import { routeIntent } from "../common/intent-router";
import type { IntentType } from "../common/intent-types";
import { MAIN_THREAD_NAME } from "../common/thread-constants";
import type { EffectiveRole, IMFileMergeReview, MergeResult } from "../../services/index";
import { isBackendId, transportFor } from "../../services/index";
import { createLogger } from "../logging";
import { authorizeIntent } from "../common/command-guard";
import { AuthorizationError } from "../../services/index";
import { ErrorCode, OrchestratorError } from "../../services/index";
import { execFile as execFileCb } from "node:child_process";
import { join as pathJoin } from "node:path";
import { promisify } from "node:util";
import { getFeishuNotifyCatalog, notify } from "./feishu-notify";
import { getFeishuCardHandlerStrings } from "./feishu-card-handler.strings";
import { getFeishuCardBuilderStrings } from "./channel/feishu-card-builders.strings";
import {
  clearInitProjectDraft,
  getOrCreateInitProjectDraft,
  resetInitProjectDraftFile,
  updateInitProjectDraft,
} from "./init-project-draft-state";
import { rm } from "node:fs/promises";
import { PlatformActionRouter } from "../common/platform-action-router";
import { resolveProjectByChatId } from "../common/project-resolution";

const execFileAsync = promisify(execFileCb);

const log = createLogger("action");
const feishuActionAdapter = new FeishuActionAdapter();
const installTaskStore = new Map<string, Array<{ taskId: string; label: string; status: "running" | "success" | "failed"; detail?: string }>>();
type InitProjectTaskStatus = "running" | "failed";
interface InitProjectTask {
  taskId: string;
  chatId: string;
  operatorId: string;
  messageId?: string;
  projectName: string;
  cwd: string;
  gitUrl?: string;
  workBranch?: string;
  status: InitProjectTaskStatus;
  error?: string;
  startedAt: string;
}
const initProjectTaskStore = new Map<string, InitProjectTask>();

function getCachedDisplayName(deps: FeishuHandlerDeps, userId: string): string {
  return deps.feishuAdapter.getCachedUserDisplayName?.(userId) ?? userId;
}

function notifyLater(
  deps: FeishuHandlerDeps,
  chatId: string,
  text: string,
  context: { label: string; messageId?: string }
): void {
  void notify(deps, chatId, text).catch((error) => {
    log.warn({
      chatId,
      messageId: context.messageId,
      err: error instanceof Error ? error.message : String(error),
    }, context.label);
  });
}

function formatApprovalTimestamp(value?: string): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return value ?? "";
  }
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const sec = String(date.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${sec} UTC`;
}

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

function extractRawCardData(response?: CardActionResponse): Record<string, unknown> | undefined {
  return response?.card?.data;
}

type AsyncCardTone = "blue" | "orange" | "grey" | "red";

function asyncToneMeta(tone: AsyncCardTone): {
  template: "blue" | "wathet" | "orange" | "grey" | "red";
  iconToken: string;
  iconColor: string;
  tagColor: "blue" | "orange" | "grey" | "red";
} {
  switch (tone) {
    case "orange":
      return { template: "orange", iconToken: "loading_outlined", iconColor: "orange", tagColor: "orange" };
    case "grey":
      return { template: "grey", iconToken: "loading_outlined", iconColor: "grey", tagColor: "grey" };
    case "red":
      return { template: "red", iconToken: "close_outlined", iconColor: "red", tagColor: "red" };
    case "blue":
    default:
      return { template: "wathet", iconToken: "loading_outlined", iconColor: "blue", tagColor: "blue" };
  }
}

function buildAsyncCardShell(
  locale: "zh-CN" | "en-US",
  options: {
    title: string;
    subtitle?: string;
    body: string;
    tone: AsyncCardTone;
    tagText: string;
  }
): Record<string, unknown> {
  const meta = asyncToneMeta(options.tone);
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: options.title },
      ...(options.subtitle ? { subtitle: { tag: "plain_text", content: options.subtitle } } : {}),
      template: meta.template,
      icon: { tag: "standard_icon", token: meta.iconToken, color: meta.iconColor },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: options.tagText },
          color: meta.tagColor
        }
      ]
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [
        {
          tag: "column_set",
          flex_mode: "none",
          background_style: "grey",
          horizontal_spacing: "default",
          columns: [{
            tag: "column",
            width: "weighted",
            weight: 1,
            elements: [{ tag: "markdown", content: options.body }]
          }]
        }
      ]
    }
  };
}

function buildAsyncProgressCard(
  locale: "zh-CN" | "en-US",
  title: string,
  body: string,
  options?: { subtitle?: string; tone?: Exclude<AsyncCardTone, "red"> }
): Record<string, unknown> {
  const s = getFeishuCardHandlerStrings(locale);
  return buildAsyncCardShell(locale, {
    title,
    subtitle: options?.subtitle,
    body: `${body}\n\n${s.asyncProgressHint}`,
    tone: options?.tone ?? "blue",
    tagText: s.asyncInProgressTag
  });
}

function buildAsyncFailureCard(
  locale: "zh-CN" | "en-US",
  title: string,
  message: string,
  options?: { subtitle?: string }
): Record<string, unknown> {
  const s = getFeishuCardHandlerStrings(locale);
  return buildAsyncCardShell(locale, {
    title,
    subtitle: options?.subtitle,
    body: message,
    tone: "red",
    tagText: s.asyncFailedTag
  });
}

function buildImmediateErrorCard(
  locale: "zh-CN" | "en-US",
  message: string,
  options?: { subtitle?: string }
): Record<string, unknown> {
  return buildAsyncFailureCard(locale, message, message, options);
}

function panelLabel(locale: "zh-CN" | "en-US", panel: string): string {
  const zh = {
    help_home: "帮助首页",
    help_threads: "线程面板",
    help_history: "快照面板",
    help_skills: "技能面板",
    help_backends: "后端面板",
    help_turns: "Turn 面板",
    help_project: "项目面板",
    help_merge: "合并面板",
    help_thread_new: "新建线程面板",
    admin_member: "成员管理",
    admin_user: "用户管理",
    admin_skill: "技能管理",
    admin_backend: "后端管理",
  } as const;
  const en = {
    help_home: "Help home",
    help_threads: "Threads",
    help_history: "Snapshots",
    help_skills: "Skills",
    help_backends: "Backends",
    help_turns: "Turns",
    help_project: "Project",
    help_merge: "Merge",
    help_thread_new: "New thread",
    admin_member: "Member admin",
    admin_user: "User admin",
    admin_skill: "Skill admin",
    admin_backend: "Backend admin",
  } as const;
  const labels = locale === "zh-CN" ? zh : en;
  return labels[panel as keyof typeof labels] ?? panel;
}

function buildPanelProgressCard(locale: "zh-CN" | "en-US", panel: string): Record<string, unknown> {
  const label = panelLabel(locale, panel);
  return buildAsyncProgressCard(
    locale,
    locale === "zh-CN" ? "正在加载面板" : "Loading panel",
    locale === "zh-CN"
      ? `正在准备 **${label}**，完成后会自动刷新当前卡片。`
      : `Preparing **${label}**. This card will refresh automatically when ready.`,
    { subtitle: label, tone: "blue" }
  );
}

function buildPanelFailureCard(locale: "zh-CN" | "en-US", panel: string, message: string): Record<string, unknown> {
  const label = panelLabel(locale, panel);
  return buildAsyncFailureCard(
    locale,
    locale === "zh-CN" ? `${label}加载失败` : `Failed to load ${label}`,
    message,
    { subtitle: label }
  );
}

function approvalDecisionLabel(locale: "zh-CN" | "en-US", decision: string): string {
  if (locale === "zh-CN") {
    if (decision === "approve") return "批准";
    if (decision === "deny") return "拒绝";
    return "本次会话批准";
  }
  if (decision === "approve") return "Approve";
  if (decision === "deny") return "Deny";
  return "Approve for session";
}

function buildUserInputSubmittedCard(
  locale: "zh-CN" | "en-US",
  actorId: string,
  threadName: string,
  turnId: string,
  questionMeta: Array<{ idx: number; id: string; defaultAnswer: string }>,
  answers: Record<string, string[]>
): Record<string, unknown> {
  const s = getFeishuCardHandlerStrings(locale);
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const summary = questionMeta.map((q) => {
    const value = answers[q.id]?.[0] ?? "";
    return `• ${q.id}: **${value}**`;
  }).join("\n");

  return {
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
        { tag: "markdown", content: s.planSelectionSubmitted(actorId, timeStr) },
        { tag: "markdown", content: summary }
      ]
    }
  };
}

async function deliverAsyncCardResult(
  deps: FeishuHandlerDeps,
  chatId: string,
  messageId: string | undefined,
  card: Record<string, unknown>,
  mutationType: import("../../services/index").AsyncPlatformMutationType
): Promise<void> {
  await deps.api.enqueueAsyncPlatformMutation({
    mutationType,
    platform: "feishu",
    chatId,
    messageId,
    payload: card,
  });
}

function startAsyncCardTask(
  deps: FeishuHandlerDeps,
  options: {
    chatId: string;
    messageId?: string;
    mutationType?: import("../../services/index").AsyncPlatformMutationType;
    failureMutationType?: import("../../services/index").AsyncPlatformMutationType;
    run: () => Promise<Record<string, unknown> | undefined>;
    onError?: (error: unknown) => Promise<Record<string, unknown> | undefined>;
  }
): void {
  void (async () => {
    try {
      const card = await options.run();
      if (card) {
        await deliverAsyncCardResult(deps, options.chatId, options.messageId, card, options.mutationType ?? "async_action_result");
      }
    } catch (error) {
      log.warn({
        chatId: options.chatId,
        messageId: options.messageId,
        err: error instanceof Error ? error.message : String(error)
      }, "async card task failed");
      if (!options.onError) return;
      const card = await options.onError(error);
      if (card) {
        await deliverAsyncCardResult(deps, options.chatId, options.messageId, card, options.failureMutationType ?? "async_action_failure");
      }
    }
  })();
}

function startAsyncPanelTask(
  deps: FeishuHandlerDeps,
  options: {
    chatId: string;
    messageId?: string;
    panelKey: string;
    run: () => Promise<Record<string, unknown>>;
  }
): CardActionResponse {
  startAsyncCardTask(deps, {
    chatId: options.chatId,
    messageId: options.messageId,
    run: options.run,
    onError: async (error) => buildPanelFailureCard(
      deps.config.locale,
      options.panelKey,
      error instanceof Error ? error.message : String(error)
    ),
  });
  return rawCard(buildPanelProgressCard(deps.config.locale, options.panelKey));
}

function encodeUtf8Base64(content: string): string {
  return Buffer.from(content, "utf-8").toString("base64");
}

function updateInitDraftFromForm(chatId: string, userId: string, formValues?: Record<string, string>): ReturnType<typeof getOrCreateInitProjectDraft> {
  return updateInitProjectDraft(chatId, userId, {
    projectName: String(formValues?.project_name ?? getOrCreateInitProjectDraft(chatId, userId).projectName ?? ""),
    projectCwd: String(formValues?.project_cwd ?? getOrCreateInitProjectDraft(chatId, userId).projectCwd ?? ""),
    gitUrl: String(formValues?.git_url ?? getOrCreateInitProjectDraft(chatId, userId).gitUrl ?? ""),
    gitToken: String(formValues?.git_token ?? getOrCreateInitProjectDraft(chatId, userId).gitToken ?? ""),
    workBranch: String(formValues?.work_branch ?? getOrCreateInitProjectDraft(chatId, userId).workBranch ?? ""),
  });
}

async function requireProjectByChatId(deps: FeishuHandlerDeps, chatId: string) {
  const project = await resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    throw new Error(`project binding not found for chatId=${chatId}`);
  }
  return project;
}

async function registerExistingChatMembers(deps: FeishuHandlerDeps, chatId: string, projectId: string): Promise<void> {
  try {
    const memberIds = await deps.feishuAdapter.listChatMembers?.(chatId);
    if (!memberIds?.length) return;
    for (const uid of memberIds) {
      await deps.api.resolveRole({ userId: uid, projectId });
    }
    log.info({ projectId, count: memberIds.length }, "bulk-registered existing chat members");
  } catch (err) {
    log.warn({ projectId, err: err instanceof Error ? err.message : String(err) }, "bulk member registration failed");
  }
}

function isRecoveryRequiredReview(review: IMFileMergeReview): boolean {
  return review.sessionState === "recovery_required";
}

function renderMergeReviewCard(deps: FeishuHandlerDeps, review: IMFileMergeReview): CardActionResponse {
  return rawCard(
    isRecoveryRequiredReview(review)
      ? deps.platformOutput.buildMergeRecoveryRequiredCard(review)
      : deps.platformOutput.buildFileReviewCard(review)
  );
}

function buildMergeReviewCanceledCard(
  deps: FeishuHandlerDeps,
  branchName: string,
  baseBranch: string | undefined,
  actorId: string
): Record<string, unknown> {
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  return {
    schema: "2.0",
    config: { width_mode: "fill", update_multi: true },
    header: {
      title: { tag: "plain_text", content: s.mergeReviewCanceledTitle(branchName) },
      subtitle: { tag: "plain_text", content: s.branchUnchanged },
      template: "grey"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "4px 12px 12px 12px",
      elements: [{
        tag: "markdown",
        content: s.mergeReviewCanceledBody(branchName, baseBranch)
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
        behaviors: [{ type: "callback", value: { action: "help_merge", ownerId: actorId, branchName } }],
        elements: [{
          tag: "markdown",
          content: s.backToMergePanel,
          icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
        }]
      }]
    }
  };
}

async function renderMergeResultCard(
  deps: FeishuHandlerDeps,
  chatId: string,
  branchName: string,
  baseBranch: string,
  result: MergeResult
): Promise<CardActionResponse> {
  switch (result.kind) {
    case "review":
      return renderMergeReviewCard(deps, result.data);
    case "summary":
      return rawCard(deps.platformOutput.buildMergeSummaryCard(result.data));
    case "preview":
      return rawCard(
        deps.platformOutput.buildMergePreviewCard(
          chatId,
          branchName,
          result.baseBranch,
          result.diffStats,
          true,
          undefined,
          undefined,
          undefined
        )
      );
    case "success": {
      const project = await resolveProjectByChatId(deps.api, chatId);
      const threadAction = project?.id ? { projectId: project.id, chatId } : undefined;
      return rawCard(
        deps.platformOutput.buildMergeResultCard(
          branchName,
          result.baseBranch,
          true,
          result.message ?? "",
          undefined,
          threadAction
        )
      );
    }
    case "conflict":
      return rawCard(
        deps.platformOutput.buildMergePreviewCard(
          chatId,
          branchName,
          result.baseBranch,
          { additions: 0, deletions: 0, filesChanged: [] },
          false,
          result.conflicts,
          undefined,
          undefined
        )
      );
    case "rejected":
      return rawCard(deps.platformOutput.buildMergeResultCard(branchName, baseBranch, false, result.message));
  }
}

const feishuActionRouter = new PlatformActionRouter<FeishuHandlerDeps, CardActionResponse | void>({
  interruptTurn: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_INTERRUPT");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    const requestedAt = new Date().toISOString();
    const interruptingCard = action.turnId
      ? deps.platformOutput.prepareInterruptingCard(action.chatId, action.turnId, {
          actorName: action.actorId,
          requestedAt
        })
      : null;
    if (action.turnId) {
      log.info({ chatId: action.chatId, turnId: action.turnId }, "interrupt callback responded with interrupting card");
    }

    void (async () => {
      try {
        log.info({ chatId: action.chatId, turnId: action.turnId }, "interrupt async flow started");
        const result = await deps.api.interruptTurn({ projectId, actorId: action.actorId, userId: action.actorId || undefined });
        log.info({ chatId: action.chatId, turnId: action.turnId, interrupted: result.interrupted }, "interrupt async backend request finished");
        if (!action.turnId) {
          return;
        }
        if (!result.interrupted) {
          await deps.platformOutput.cancelInterruptingCard(action.chatId, action.turnId);
          return;
        }
        await deps.platformOutput.finalizeInterruptAction(action.chatId, action.turnId);
      } catch (error) {
        log.warn({
          chatId: action.chatId,
          turnId: action.turnId,
          err: error instanceof Error ? error.message : String(error)
        }, "interrupt async flow failed");
        if (action.turnId) {
          try {
            await deps.platformOutput.cancelInterruptingCard(action.chatId, action.turnId);
          } catch (cancelError) {
            log.warn({
              chatId: action.chatId,
              turnId: action.turnId,
              err: cancelError instanceof Error ? cancelError.message : String(cancelError)
            }, "cancelInterruptingCard after interrupt failure failed");
          }
        }
      }
    })();

    // Merge resolver: interrupt only stops the current turn.
    // The merge review session is NOT cancelled — user must use the summary card cancel button for that.
    return interruptingCard ? rawCard(interruptingCard) : undefined;
  },
  acceptTurn: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    if (!action.turnId) return;
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await deps.api.acceptTurn({ projectId, turnId: action.turnId, actorId: action.actorId });
        return await deps.platformOutput.updateCardAction(action.chatId, action.turnId!, "accepted") ?? undefined;
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncAcceptTurnFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.turnId }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncAcceptTurnTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncAcceptTurnBody(action.turnId),
      { subtitle: action.turnId }
    ));
  },
  revertTurn: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    if (!action.turnId) return;
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await deps.api.revertTurn({ projectId, turnId: action.turnId, actorId: action.actorId });
        return await deps.platformOutput.updateCardAction(action.chatId, action.turnId!, "reverted") ?? undefined;
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncRevertTurnFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.turnId }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncRevertTurnTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncRevertTurnBody(action.turnId),
      { subtitle: action.turnId, tone: "orange" }
    ));
  },
  approvalDecision: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      mutationType: "approval_result",
      failureMutationType: "async_action_failure",
      run: async () => extractRawCardData(await handleApprovalAction(deps, action.chatId, action.actorId, action.decision, {
        callId: action.approvalId,
        threadId: action.threadId,
        turnId: action.turnId,
        approvalType: action.approvalType
      })),
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncApprovalDecisionFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.turnId || action.approvalId }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncApprovalDecisionTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncApprovalDecisionBody(approvalDecisionLabel(deps.config.locale, action.decision)),
      { subtitle: action.turnId || action.approvalId, tone: "orange" }
    ));
  },
  userInputReply: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "TURN_START");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    const callId = String(action.callId ?? "");
    const metaStr = String(actionValue.questionMeta ?? "[]");
    const threadNameFromCard = String(actionValue.threadName ?? "").trim();
    const turnId = String(actionValue.turnId ?? "").trim();
    const messageId = String(payload.context?.open_message_id ?? "");
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

    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    const binding = await deps.api.getUserActiveThread({ projectId, userId: action.actorId });
    const threadName = threadNameFromCard || binding?.threadName || "__main__";

    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await deps.api.respondUserInput({ projectId, threadName, callId, answers });
        return buildUserInputSubmittedCard(deps.config.locale, action.actorId, threadName, turnId, questionMeta, answers);
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncSubmitUserInputFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: [threadName, turnId].filter(Boolean).join(" · ") || callId }
      )
    });
    return rawCard(buildUserInputSubmittedCard(deps.config.locale, action.actorId, threadName, turnId, questionMeta, answers));
  },
  threadCreate: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_NEW");
    const payload = action.raw as CardActionData;
    const actionValue = ((payload.action?.value ?? {}) as Record<string, unknown>);
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
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
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const threadName = String(action.threadName ?? "");
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => extractRawCardData(await handleThreadSwitchAction(deps, action.chatId, action.actorId, "switch_thread", {
        fromHelp: action.fromHelp,
        threadName
      })),
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        s.asyncSwitchThreadFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: threadName || undefined }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      s.asyncSwitchThreadTitle,
      s.asyncSwitchThreadBody(threadName || "__main__"),
      { subtitle: threadName || undefined, tone: "blue" }
    ));
  },
  threadLeave: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_SWITCH");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => extractRawCardData(await handleThreadSwitchAction(deps, action.chatId, action.actorId, "switch_to_main", {
        fromHelp: action.fromHelp
      })),
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        s.asyncSwitchToMainFailedTitle,
        error instanceof Error ? error.message : String(error)
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      s.asyncSwitchToMainTitle,
      s.asyncSwitchToMainBody,
      { tone: "blue" }
    ));
  },
  helpPanel: async (deps, action) => {
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    switch (action.panel) {
      case "help_home":
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_home",
          run: () => resolveHelpCard(deps, action.chatId, action.actorId),
        });
      case "help_threads":
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_LIST");
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_threads",
          run: () => resolveHelpThreadCard(deps, action.chatId, action.actorId),
        });
      case "help_history":
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SNAPSHOT_LIST");
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_history",
          run: () => resolveSnapshotCard(deps, action.chatId, action.actorId, true),
        });
      case "help_skills":
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_LIST");
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_skills",
          run: () => resolveHelpSkillCard(deps, action.chatId, action.actorId),
        });
      case "help_backends":
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_backends",
          run: () => resolveHelpBackendCard(deps, action.actorId),
        });
      case "help_turns":
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_turns",
          run: () => resolveHelpTurnCard(deps, action.chatId, action.actorId),
        });
      case "help_project":
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_project",
          run: () => resolveHelpProjectCard(deps, action.chatId, action.actorId),
        });
      case "help_merge": {
        await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
        const actionValue = (((action.raw as CardActionData)?.action?.value ?? {}) as Record<string, unknown>);
        if (!checkHelpCardOwner(actionValue, action.actorId)) {
          const ownerId = String(actionValue.ownerId ?? "");
          if (ownerId) {
            const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
            return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
          }
        }
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "help_merge",
          run: () => resolveHelpMergeCard(deps, action.chatId, action.actorId),
        });
      }
    }
  },
  helpThreadNew: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_NEW");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    return startAsyncPanelTask(deps, {
      chatId: action.chatId,
      messageId,
      panelKey: "help_thread_new",
      run: () => resolveHelpThreadNewCard(deps, action.chatId, action.actorId),
    });
  },
  helpProjectPush: async (deps, action) => {
    const { getFeishuCardBuilderStrings } = await import("./channel/feishu-card-builders.strings");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    const messageId = String(payload.context?.open_message_id ?? "");
    const projectId = String(actionValue.projectId ?? "");
    if (!projectId) return;
    const bs = getFeishuCardBuilderStrings(deps.config.locale);
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    const project = await deps.api.getProjectRecord(projectId);
    if (!project) return;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await execFileAsync("git", ["push", "origin", project.workBranch], { cwd: project.cwd });
        notifyLater(deps, action.chatId, bs.helpProjectPushSuccess, {
          label: "notify help project push success failed",
          messageId,
        });
        return resolveHelpProjectCard(deps, action.chatId, action.actorId);
      },
      onError: async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ projectId, err: msg }, "help_project_push failed");
        notifyLater(deps, action.chatId, ERR.generic(bs.helpProjectPushFailed(msg)), {
          label: "notify help project push failure failed",
          messageId,
        });
        return resolveHelpProjectCard(deps, action.chatId, action.actorId);
      }
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncPushTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncPushBody(project.workBranch),
      { subtitle: project.name || projectId, tone: "blue" }
    ));
  },
  helpSkillInstall: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_INSTALL");
    const payload = action.raw as CardActionData;
    const actionValue = ((payload.action?.value ?? {}) as Record<string, unknown>);
    const messageId = String(payload.context?.open_message_id ?? "");
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
      }
    }
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.skillName) return;
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await deps.api.installSkill({ source: action.skillName, projectId: project?.id, userId: action.actorId, actorId: action.actorId });
        return resolveHelpSkillCard(deps, action.chatId, action.actorId);
      },
      onError: async (error) => {
        notifyLater(deps, action.chatId, ERR.skillInstall(error instanceof Error ? error.message : String(error)), {
          label: "notify help skill install failure failed",
          messageId,
        });
        return resolveHelpSkillCard(deps, action.chatId, action.actorId);
      }
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncEnableSkillTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncEnableSkillBody(action.skillName),
      { subtitle: project?.name }
    ));
  },
  helpSkillRemove: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "SKILL_REMOVE");
    const actionValue = (((action.raw as CardActionData)?.action?.value ?? {}) as Record<string, unknown>);
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
      }
    }
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.name) return;
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    try {
      if (project?.id) {
        await deps.api.unbindSkillFromProject({ projectId: project.id, skillName: action.name, actorId: action.actorId });
      } else {
        await deps.api.removeSkill({ name: action.name, actorId: action.actorId });
      }
    } catch (error) {
      return rawCard(buildImmediateErrorCard(
        deps.config.locale,
        ERR.skillRemove(error instanceof Error ? error.message : String(error))
      ));
    }
    return rawCard(await resolveHelpSkillCard(deps, action.chatId, action.actorId));
  },
  mergeConfirm: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => extractRawCardData(await handleMergeAction(deps, action.chatId, "confirm_merge", { branchName: action.branchName }, {
        userId: action.actorId,
      })),
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncRunMergeTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncRunMergeBody(action.branchName),
      { subtitle: action.branchName, tone: "orange" }
    ));
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
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await deps.api.cancelMergeReview({ projectId, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
        return buildMergeReviewCanceledCard(deps, action.branchName, action.baseBranch, action.actorId);
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncCancelMergeReviewFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.branchName }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncCancelMergeReviewTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncCancelMergeReviewBody(action.branchName),
      { subtitle: action.branchName, tone: "grey" }
    ));
  },
  mergeReviewStart: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    const messageId = String(payload.context?.open_message_id ?? "");
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => extractRawCardData(await startMergeReviewFlow(deps, {
        chatId: action.chatId,
        operatorId: action.actorId,
        messageId,
        actionValue: {
          ...actionValue,
          branchName: action.branchName,
          baseBranch: action.baseBranch ?? actionValue.baseBranch
        }
      }, action.branchName)),
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncStartMergeReviewFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.branchName }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncStartMergeReviewTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncStartMergeReviewBody(action.branchName),
      { subtitle: action.branchName, tone: "orange" }
    ));
  },
  mergePreview: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const actionValue = (payload.action?.value ?? {}) as Record<string, unknown>;
    const messageId = String(payload.context?.open_message_id ?? "");
    if (!checkHelpCardOwner(actionValue, action.actorId)) {
      const ownerId = String(actionValue.ownerId ?? "");
      if (ownerId) {
        const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
        return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
      }
    }
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        const preview = await deps.api.handleMergePreview({ projectId, branchName: action.branchName, context: {
          userId: action.actorId || undefined,
          traceId: messageId || undefined,
          threadId: typeof actionValue.threadId === "string" ? actionValue.threadId : undefined,
          turnId: typeof actionValue.turnId === "string" ? actionValue.turnId : undefined,
        } });
        if (preview.kind === "conflict") {
          return extractRawCardData(await startMergeReviewFlow(deps, {
            chatId: action.chatId,
            operatorId: action.actorId,
            messageId,
            actionValue,
          }, action.branchName));
        }
        return extractRawCardData(await renderMergeResultCard(deps, action.chatId, action.branchName, "main", preview));
      },
      onError: async (error) => {
        notifyLater(deps, action.chatId, ERR.mergePreview(error instanceof Error ? error.message : String(error)), {
          label: "notify merge preview failure failed",
          messageId,
        });
        return buildAsyncFailureCard(
          deps.config.locale,
          getFeishuCardHandlerStrings(deps.config.locale).asyncPreviewMergeFailedTitle,
          error instanceof Error ? error.message : String(error),
          { subtitle: action.branchName }
        );
      }
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncPreviewMergeTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncPreviewMergeBody(action.branchName),
      { subtitle: action.branchName, tone: "orange" }
    ));
  },
  mergeRetryFile: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const formValues = (payload.action as Record<string, unknown>)?.form_value as Record<string, string> | undefined;
    const feedback = formValues?.merge_feedback?.trim() || "";
    const messageId = String(payload.context?.open_message_id ?? "");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName || !action.filePath) return;
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        const review = await deps.api.retryMergeFile({ projectId, branchName: action.branchName, filePath: action.filePath, feedback, actorId: action.actorId, context: {
          userId: action.actorId || undefined,
          traceId: String(payload.context?.open_message_id ?? "") || undefined,
          threadId: typeof payload.action?.value?.threadId === "string" ? payload.action.value.threadId : undefined,
          turnId: typeof payload.action?.value?.turnId === "string" ? payload.action.value.turnId : undefined,
        } });
        const s = getFeishuCardHandlerStrings(deps.config.locale);
        notifyLater(deps, action.chatId, s.mergeRetrying(action.filePath), {
          label: "notify merge retry progress failed",
          messageId,
        });
        return extractRawCardData(await renderMergeResultCard(deps, action.chatId, action.branchName, "main", review));
      },
      onError: async (error) => {
        notifyLater(deps, action.chatId, ERR.generic(error instanceof Error ? error.message : String(error)), {
          label: "notify merge retry failure failed",
          messageId,
        });
        return buildAsyncFailureCard(
          deps.config.locale,
          getFeishuCardHandlerStrings(deps.config.locale).asyncRetryMergeFileFailedTitle,
          error instanceof Error ? error.message : String(error),
          { subtitle: action.filePath }
        );
      }
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncRetryMergeFileTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncRetryMergeFileBody(action.filePath),
      { subtitle: action.branchName, tone: "orange" }
    ));
  },
  mergeReviewOpenFileDetail: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
      const reviewResult = await deps.api.getMergeReview({ projectId, branchName: action.branchName });
      if (reviewResult.kind !== "review") {
        return renderMergeResultCard(deps, action.chatId, action.branchName, "main", reviewResult);
      }
      const review = reviewResult.data;
      if (isRecoveryRequiredReview(review)) {
        return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
      }
      return rawCard(deps.platformOutput.buildMergeFileDetailCard(review));
    } catch (error) {
      return rawCard(buildImmediateErrorCard(
        deps.config.locale,
        ERR.generic(error instanceof Error ? error.message : String(error))
      ));
    }
  },
  mergeReviewBackOverview: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
      const reviewResult = await deps.api.getMergeReview({ projectId, branchName: action.branchName });
      if (reviewResult.kind !== "review") {
        return renderMergeResultCard(deps, action.chatId, action.branchName, "main", reviewResult);
      }
      const review = reviewResult.data;
      return renderMergeReviewCard(deps, review);
    } catch (error) {
      return rawCard(buildImmediateErrorCard(
        deps.config.locale,
        ERR.generic(error instanceof Error ? error.message : String(error))
      ));
    }
  },
  mergeReviewAgentAssistForm: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    try {
      const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
      const reviewResult = await deps.api.getMergeReview({ projectId, branchName: action.branchName });
      if (reviewResult.kind !== "review") {
        return renderMergeResultCard(deps, action.chatId, action.branchName, "main", reviewResult);
      }
      const review = reviewResult.data;
      if (isRecoveryRequiredReview(review)) {
        return rawCard(deps.platformOutput.buildMergeRecoveryRequiredCard(review));
      }
      const catalog = await deps.api.getBackendCatalog({ projectId, userId: action.actorId });
      const backends = catalog.backends.map((backend) => ({
        name: backend.backendId,
        models: Array.from(new Set(backend.options.map((option) => option.model))),
      }));
      return rawCard(deps.platformOutput.buildMergeAgentAssistCard(review, backends));
    } catch (error) {
      return rawCard(buildImmediateErrorCard(
        deps.config.locale,
        ERR.generic(error instanceof Error ? error.message : String(error))
      ));
    }
  },
  mergeBatchRetry: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
    if (!action.branchName) return;
    if (!action.files || action.files.length === 0) {
      return rawCard(buildImmediateErrorCard(
        deps.config.locale,
        deps.config.locale === "zh-CN"
          ? "请至少选择 1 个需要继续交给 Agent 修改的文件；未选中的文件会保持不变。"
          : "Select at least one file to continue revising with the agent. Unselected files will stay unchanged."
      ));
    }
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        const review = await deps.api.retryMergeFiles({ actorId: action.actorId,
          projectId,
          branchName: action.branchName,
          filePaths: action.files,
          feedback: action.feedback,
          context: { userId: action.actorId }
        });
        return extractRawCardData(await renderMergeResultCard(deps, action.chatId, action.branchName, "main", review));
      },
      onError: async (error) => {
        notifyLater(deps, action.chatId, ERR.generic(error instanceof Error ? error.message : String(error)), {
          label: "notify batch retry failure failed",
          messageId,
        });
        return buildAsyncFailureCard(
          deps.config.locale,
          getFeishuCardHandlerStrings(deps.config.locale).asyncBatchRetryMergeFailedTitle,
          error instanceof Error ? error.message : String(error),
          { subtitle: action.branchName }
        );
      }
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncBatchRetryMergeTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncBatchRetryMergeBody(action.files.length),
      { subtitle: action.branchName, tone: "orange" }
    ));
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
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const actionValue = {
      ...turnActionValue(undefined, action.turnId),
      threadId: action.threadId,
      ownerId: action.ownerId,
    };
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => extractRawCardData(await handleSnapshotAction(deps, action.chatId, action.actorId, actionValue)),
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncJumpSnapshotFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.turnId }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncJumpSnapshotTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncJumpSnapshotBody(action.turnId),
      { subtitle: action.threadId }
    ));
  },
  mergeFileDecision: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    const result = await deps.api.mergeDecideFile({ actorId: action.actorId,
      projectId,
      branchName: action.branchName,
      filePath: action.filePath,
      decision: action.decision,
      context: { userId: action.actorId }
    });
    return renderMergeResultCard(deps, action.chatId, action.branchName, "main", result);
  },
  mergeAcceptAll: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        const summary = await deps.api.mergeAcceptAll({ projectId, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
        return extractRawCardData(await renderMergeResultCard(deps, action.chatId, action.branchName, "main", summary));
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncAcceptAllMergeFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.branchName }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncAcceptAllMergeTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncAcceptAllMergeBody(action.branchName),
      { subtitle: action.branchName, tone: "orange" }
    ));
  },
  mergeAgentAssist: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        if (action.backendId && action.model) {
          await deps.api.configureMergeResolver({
            projectId,
            branchName: action.branchName,
            backendId: action.backendId,
            model: action.model,
          });
        }
        const review = await deps.api.resolveConflictsViaAgent({ projectId, branchName: action.branchName, actorId: action.actorId, prompt: action.prompt, context: { userId: action.actorId } });
        return extractRawCardData(await renderMergeResultCard(deps, action.chatId, action.branchName, "main", review));
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncAgentTakeoverFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.branchName }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncAgentTakeoverTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncAgentTakeoverBody(action.branchName),
      { subtitle: action.branchName, tone: "orange" }
    ));
  },
  mergeCommit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const projectId = (await requireProjectByChatId(deps, action.chatId)).id;
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        const result = await deps.api.commitMergeReview({ projectId, branchName: action.branchName, actorId: action.actorId, context: { userId: action.actorId } });
        const project = await resolveProjectByChatId(deps.api, action.chatId);
        if (result.kind === "success" && project?.id) {
          deps.api.detectStaleThreads({ projectId: project.id, mergedThreadName: action.branchName }).catch(() => {});
        }
        return extractRawCardData(await renderMergeResultCard(deps, action.chatId, action.branchName, "main", result));
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncCommitMergeFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.branchName }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncCommitMergeTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncCommitMergeBody(action.branchName),
      { subtitle: action.branchName, tone: "orange" }
    ));
  },
  keepMergedThread: async (deps, action) => {
    const s = getFeishuCardBuilderStrings(deps.config.locale);
    return rawCard({
      schema: "2.0",
      config: { width_mode: "fill", update_multi: true },
      header: {
        title: { tag: "plain_text", content: `✓ ${action.branchName}` },
        subtitle: { tag: "plain_text", content: s.mergeKeepThreadSuccessSubtitle },
        template: "blue",
        icon: { tag: "standard_icon", token: "check_outlined", color: "blue" },
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "8px 12px 12px 12px",
        elements: [
          {
            tag: "interactive_container",
            width: "fill",
            height: "auto",
            has_border: true,
            border_color: "grey",
            corner_radius: "8px",
            padding: "10px 12px 10px 12px",
            behaviors: [{ type: "callback", value: { action: "help_threads", ownerId: action.actorId } }],
            elements: [{
              tag: "markdown",
              content: s.mergeBackToThreads,
              icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
            }]
          }
        ]
      }
    });
  },
  deleteMergedThread: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "THREAD_MERGE");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    const s = getFeishuCardBuilderStrings(deps.config.locale);
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await deps.api.deleteThread({ projectId: action.projectId, threadName: action.branchName, actorId: action.actorId });
        return {
          schema: "2.0",
          config: { width_mode: "fill", update_multi: true },
          header: {
            title: { tag: "plain_text", content: `🗑 ${action.branchName}` },
            subtitle: { tag: "plain_text", content: s.mergeDeleteThreadSuccessSubtitle },
            template: "grey",
            icon: { tag: "standard_icon", token: "delete_outlined", color: "grey" },
          },
          body: { direction: "vertical", elements: [] }
        };
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncDeleteThreadFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: action.branchName }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncDeleteThreadTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncDeleteThreadBody(action.branchName),
      { subtitle: action.branchName, tone: "grey" }
    ));
  },
  adminUserToggle: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_ADD");
    if (!action.targetUserId) return;
    if (action.promote) {
      await deps.api.addAdmin(action.targetUserId);
    } else {
      await deps.api.removeAdmin(action.targetUserId);
    }
    return rawCard(deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps)));
  },
  adminPanel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    switch (action.panel) {
      case "home":
        return rawCard(deps.platformOutput.buildAdminHelpCard());
      case "project":
        return rawCard(deps.platformOutput.buildAdminProjectCard(await buildAdminProjectData(deps)));
      case "member":
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "admin_member",
          run: async () => deps.platformOutput.buildAdminMemberCard(await buildAdminMemberData(deps)),
        });
      case "user":
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "admin_user",
          run: async () => deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps)),
        });
      case "skill": {
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "admin_skill",
          run: async () => deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)),
        });
      }
      case "backend": {
        return startAsyncPanelTask(deps, {
          chatId: action.chatId,
          messageId,
          panelKey: "admin_backend",
          run: async () => {
            const data = await buildAdminBackendData(deps);
            const card = deps.platformOutput.buildAdminBackendCard(data);
            log.info({ cardSize: JSON.stringify(card).length, elementCount: (card as { body?: { elements?: unknown[] } }).body?.elements?.length }, "admin_panel_backend card built");
            return card;
          },
        });
      }
    }
  },
  adminUserPage: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const payload = action.raw as CardActionData;
    const messageId = String(payload.context?.open_message_id ?? "");
    return startAsyncPanelTask(deps, {
      chatId: action.chatId,
      messageId,
      panelKey: "admin_user",
      run: async () => deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps, Math.max(0, action.page))),
    });
  },
  // ── Project Init / Bind ───────────────────────────────────────────────────
  initProject: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    const payload = action.raw as CardActionData;
    const actionValue = payload.action?.value ?? {};
    return handleInitProjectAction(deps, payload, action.chatId, action.actorId, actionValue);
  },
  initProjectFileOpen: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    const payload = action.raw as CardActionData;
    const draft = updateInitDraftFromForm(action.chatId, action.actorId, payload.action?.form_value);
    const content = action.fileKey === "agents_md" ? draft.agentsMdContent : draft.gitignoreContent;
    return rawCard(deps.platformOutput.buildInitProjectFileEditorCard(action.fileKey, content));
  },
  initProjectFileSave: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    const payload = action.raw as CardActionData;
    const content = String(payload.action?.form_value?.file_content ?? "");
    const draft = updateInitProjectDraft(action.chatId, action.actorId, action.fileKey === "agents_md"
      ? { agentsMdContent: content }
      : { gitignoreContent: content });
    return rawCard(deps.platformOutput.buildInitCreateMenuCard(draft));
  },
  initProjectFileResetTemplate: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    const draft = resetInitProjectDraftFile(action.chatId, action.actorId, action.fileKey);
    const content = action.fileKey === "agents_md" ? draft.agentsMdContent : draft.gitignoreContent;
    return rawCard(deps.platformOutput.buildInitProjectFileEditorCard(action.fileKey, content));
  },
  initRootMenu: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    clearInitProjectDraft(action.chatId, action.actorId);
    return rawCard(deps.platformOutput.buildInitCard(await getUnboundProjects(deps)));
  },
  initBindMenu: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    return rawCard(deps.platformOutput.buildInitBindMenuCard(await getUnboundProjects(deps)));
  },
  initCreateMenu: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    return rawCard(deps.platformOutput.buildInitCreateMenuCard(getOrCreateInitProjectDraft(action.chatId, action.actorId)));
  },
  initBindExisting: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "PROJECT_CREATE");
    if (!action.projectId || !action.chatId) return;
    try {
      const result = await deps.api.linkProjectToChat({ chatId: action.chatId, projectId: action.projectId, ownerId: action.actorId, actorId: action.actorId });
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
    const messageId = String(payload.context?.open_message_id ?? "");
    const skillName = String(payload.action?.form_value?.skill_name ?? actionValue.skill_name ?? "");
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        await handleSkillAction(deps, payload, action.chatId, actionValue);
        return await resolveHelpSkillCard(deps, action.chatId, action.actorId);
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncInstallSkillFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: skillName || undefined }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncEnableSkillTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncEnableSkillBody(skillName),
      { subtitle: skillName || undefined }
    ));
  },

  // ── Admin Project ────────────────────────────────────────────────────────
  adminProjectEdit: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    const project = await deps.api.getProjectRecord(action.projectId);
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
    const currentProject = await deps.api.getProjectRecord(action.projectId);
    if (!currentProject) return;
    try {
      deps.api.updateProjectConfig({
        projectId: action.projectId,
        actorId: action.actorId,
        gitUrl: newGitUrl,
      });
    } catch {
      // Name conflict — re-render edit card
      const card = deps.platformOutput.buildAdminProjectEditCard({
        id: currentProject.id, name: currentProject.name, gitUrl: currentProject.gitUrl
      });
      return rawCard(alignButtonStyle(card, s.alignBackProjectManagement, s.alignSave));
    }
    if (newGitUrl && currentProject.cwd) {
      try {
        await deps.api.updateGitRemote({ projectId: action.projectId!, gitUrl: newGitUrl, actorId: action.actorId });
      } catch (err) {
        log.warn({ projectId: action.projectId, err }, "admin_project_save: updateGitRemote failed");
      }
    }
    log.info({ projectId: action.projectId, newName, newGitUrl }, "admin_project_save");
    return rawCard(deps.platformOutput.buildAdminProjectCard(await buildAdminProjectData(deps)));
  },
  adminProjectToggle: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const result = await deps.api.toggleProjectStatus({ projectId: action.projectId, actorId: action.actorId });
    if (!result) return;
    const { project, wasActive } = result;
    if (wasActive && project.chatId) {
      await deps.api.disableProject({ projectId: project.id, actorId: action.actorId });
    }
    if (!wasActive && project.chatId) {
      await deps.api.reactivateProject({ projectId: project.id, actorId: action.actorId });
      log.info({ projectId: action.projectId }, "session recovery after re-enable done");
    }
    log.info({ projectId: action.projectId, newStatus: project.status }, "admin_project_toggle");
    return rawCard(deps.platformOutput.buildAdminProjectCard(await buildAdminProjectData(deps)));
  },
  adminProjectUnbind: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const currentProject = await deps.api.getProjectRecord(action.projectId);
    const oldChatId = currentProject?.chatId ?? "";
    await deps.api.unlinkProject({ projectId: action.projectId, actorId: action.actorId });
    if (oldChatId) {
      void deps.feishuAdapter.leaveChat(oldChatId).catch((error) => {
        log.warn({ oldChatId, err: error instanceof Error ? error.message : String(error) }, "leaveChat after unbind failed");
      });
    }
    log.info({ projectId: action.projectId, oldChatId, newStatus: "disabled" }, "admin_project_unbind");
    return rawCard(deps.platformOutput.buildAdminProjectCard(await buildAdminProjectData(deps)));
  },
  adminProjectDelete: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.projectId) return;
    const currentProject = await deps.api.getProjectRecord(action.projectId);
    const oldChatId = currentProject?.chatId ?? "";
    await deps.api.deleteProject({ projectId: action.projectId, actorId: action.actorId });
    if (oldChatId) {
      void deps.feishuAdapter.leaveChat(oldChatId).catch((error) => {
        log.warn({ oldChatId, err: error instanceof Error ? error.message : String(error) }, "leaveChat after delete failed");
      });
    }
    log.info({ projectId: action.projectId, oldChatId }, "admin_project_delete");
    return rawCard(deps.platformOutput.buildAdminProjectCard(await buildAdminProjectData(deps)));
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
    const data = await buildAdminProjectData(deps);
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
    const messageId = String(payload.context?.open_message_id ?? "");
    if (!keyword) {
      return rawCard(deps.platformOutput.buildAdminUserCard(await buildAdminUserData(deps)));
    }
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => {
        const allUsers = await deps.api.listUsers({ limit: 10000 });
        const matchingIds: string[] = [];
        for (const u of allUsers.users) {
          const displayName = await deps.feishuAdapter.getUserDisplayName?.(u.userId) ?? u.userId;
          if (displayName.toLowerCase().includes(keyword.toLowerCase())) {
            matchingIds.push(u.userId);
          }
        }
        const { users, total } = await deps.api.listUsers({ userIds: matchingIds, limit: USER_PAGE_SIZE });
        const enriched = await Promise.all(users.map(async u => ({
          userId: u.userId,
          displayName: await deps.feishuAdapter.getUserDisplayName?.(u.userId),
          sysRole: u.sysRole === "admin" ? 1 as const : 0 as const,
          source: u.source as "env" | "im"
        })));
        return deps.platformOutput.buildAdminUserCard({
          kind: "admin_user", users: enriched, total, page: 0, pageSize: USER_PAGE_SIZE
        }, keyword);
      },
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncSearchUsersFailedTitle,
        error instanceof Error ? error.message : String(error),
        { subtitle: keyword }
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncSearchUsersTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncSearchUsersBody(keyword),
      { subtitle: keyword, tone: "blue" }
    ));
  },

  // ── Admin Member / Role ──────────────────────────────────────────────────
  adminMemberRoleChange: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "USER_ROLE");
    const payload = action.raw as CardActionData;
    const newRole = String((payload.action as Record<string, unknown>)?.option ?? "");
    if (!action.targetUserId || !action.projectId || !["maintainer", "developer", "auditor"].includes(newRole)) {
      return rawCard(deps.platformOutput.buildAdminMemberCard(await buildAdminMemberData(deps)));
    }
    await deps.api.updateProjectMemberRole({ projectId: action.projectId, userId: action.targetUserId, role: newRole as "maintainer" | "developer" | "auditor", actorId: action.actorId });
    log.info({ targetUserId: action.targetUserId, projectId: action.projectId, newRole }, "admin_member_role_change");
    return rawCard(deps.platformOutput.buildAdminMemberCard(await buildAdminMemberData(deps)));
  },
  helpRoleChange: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "USER_ROLE");
    const payload = action.raw as CardActionData;
    const newRole = String((payload.action as Record<string, unknown>)?.option ?? "");
    if (!action.targetUserId || !action.projectId || !["maintainer", "developer", "auditor"].includes(newRole)) {
      return;
    }
    await deps.api.updateProjectMemberRole({ projectId: action.projectId, userId: action.targetUserId, role: newRole as "maintainer" | "developer" | "auditor", actorId: action.actorId });
    const updatedMembers = (await deps.api.listProjectMembers(action.projectId)).map((m: { userId: string; role: string }) => ({
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
    const messageId = String(payload.context?.open_message_id ?? "");
    startAsyncCardTask(deps, {
      chatId: action.chatId,
      messageId,
      run: async () => extractRawCardData(await handleAdminSkillFileInstallConfirm(deps, payload, action.chatId, action.actorId)),
      onError: async (error) => buildAsyncFailureCard(
        deps.config.locale,
        getFeishuCardHandlerStrings(deps.config.locale).asyncInstallSkillFailedTitle,
        error instanceof Error ? error.message : String(error)
      )
    });
    return rawCard(buildAsyncProgressCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncInstallSkillTitle,
      getFeishuCardHandlerStrings(deps.config.locale).asyncInstallSkillBody,
      { tone: "blue" }
    ));
  },
  adminSkillFileInstallCancel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    return handleAdminSkillFileInstallCancel(deps, action.chatId, action.actorId);
  },
  adminSkillBind: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!action.pluginName || !project?.id) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      return rawCard(buildImmediateErrorCard(deps.config.locale, s.enablePluginNoProject));
    }
    await deps.api.bindSkillToProject({ projectId: project.id, skillName: action.pluginName, actorId: action.actorId });
    log.info({ chatId: action.chatId, projectId: project.id, pluginName: action.pluginName, operatorId: action.actorId }, "admin_skill_bind");
    return rawCard(deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, action.chatId)));
  },
  adminSkillUnbind: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    const project = await resolveProjectByChatId(deps.api, action.chatId);
    if (!action.pluginName || !project?.id) return;
    await deps.api.unbindSkillFromProject({ projectId: project.id, skillName: action.pluginName, actorId: action.actorId });
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
      if (formValues.approval_policy) await deps.api.updateBackendPolicy({ actorId: action.actorId, backendId: action.backend, key: "approval_policy", value: String(formValues.approval_policy) });
      if (formValues.sandbox_mode) await deps.api.updateBackendPolicy({ actorId: action.actorId, backendId: action.backend, key: "sandbox_mode", value: String(formValues.sandbox_mode) });
    } else if (action.backend === "opencode") {
      if (formValues.permission_question) await deps.api.updateBackendPolicy({ actorId: action.actorId, backendId: action.backend, key: "permission_question", value: String(formValues.permission_question) });
    } else if (action.backend === "claude-code") {
      if (formValues.defaultMode) await deps.api.updateBackendPolicy({ actorId: action.actorId, backendId: action.backend, key: "defaultMode", value: String(formValues.defaultMode) });
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
    await deps.api.adminAddProvider({ actorId: action.actorId, backendId: action.backend, providerName, baseUrl, apiKeyEnv });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendEditCard(data, action.backend));
  },
  adminBackendRemoveProvider: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider) return;
    await deps.api.adminRemoveProvider({ actorId: action.actorId, backendId: action.backend, providerName: action.provider });
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
    await deps.api.adminAddModel({ actorId: action.actorId, backendId: action.backend, providerName: action.provider, modelName, modelConfig });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendRemoveModel: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider || !action.model) return;
    await deps.api.adminRemoveModel({ actorId: action.actorId, backendId: action.backend, providerName: action.provider, modelName: action.model });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendRecheck: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.provider) return;
    log.info({ backendId: action.backend, providerName: action.provider, chatId: action.chatId }, "admin_backend_recheck");
    await deps.api.adminTriggerRecheck({ actorId: action.actorId, backendId: action.backend, providerName: action.provider });
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
    const configs = await deps.api.readBackendConfigs();
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

    await deps.api.adminWriteProfile({ actorId: action.actorId, backendId: action.backend, profileName, model: profileModel, provider: providerName, extras });
    const data = await buildAdminBackendData(deps);
    return rawCard(deps.platformOutput.buildAdminBackendModelCard(data, action.backend));
  },
  adminBackendRemoveProfile: async (deps, action) => {
    await authorizeFeishuCardIntent(deps, action.chatId, action.actorId, "ADMIN_HELP");
    if (!action.backend || !action.profileName) return;
    await deps.api.adminDeleteProfile({ actorId: action.actorId, backendId: action.backend, profileName: action.profileName });
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
  const project = await resolveProjectByChatId(deps.api, chatId);
  const role = await deps.api.resolveRole({ userId: operatorId, projectId: project?.id }) as EffectiveRole | null;
  authorizeIntent(role, intent);
}

async function resolveUnifiedTurnCard(deps: FeishuHandlerDeps, chatId: string, operatorId: string, turnId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const projectId = (await requireProjectByChatId(deps, chatId)).id;
    const recovery = await deps.api.getTurnDetail({ projectId, turnId });
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
      const projectId = String(error.meta?.projectId ?? (await resolveProjectByChatId(deps.api, chatId))?.id ?? "unknown");
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
  await deliverAsyncCardResult(deps, chatId, undefined, helpCard, "async_action_result");
}

async function getUnboundProjects(deps: FeishuHandlerDeps): Promise<Array<{ id: string; name: string; cwd: string; gitUrl?: string }>> {
  return await deps.api.listUnboundProjects();
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
  const projectId = (await requireProjectByChatId(deps, ctx.chatId)).id;
  const review = await deps.api.startMergeReview({ projectId, branchName, actorId: ctx.operatorId, context });
  return renderMergeResultCard(deps, ctx.chatId, branchName, "main", review);
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
  const draft = updateInitDraftFromForm(chatId, operatorId, formValues);
  const projectName = String(formValues?.project_name ?? actionValue.project_name ?? draft.projectName ?? "").trim() || `project-${Date.now()}`;
  const rawCwd = String(formValues?.project_cwd ?? actionValue.project_cwd ?? draft.projectCwd ?? "").trim();
  const gitUrl = String(formValues?.git_url ?? actionValue.git_url ?? draft.gitUrl ?? "").trim();
  const gitToken = String(formValues?.git_token ?? actionValue.git_token ?? draft.gitToken ?? "").trim();
  const workBranch = String(formValues?.work_branch ?? actionValue.work_branch ?? draft.workBranch ?? "").trim();
  const messageId = String(payload.context?.open_message_id ?? "");

  let sanitized: { absolute: string; relative: string };
  try {
    sanitized = sanitizeProjectPath(rawCwd, projectName, deps.config.cwd, deps.config.locale);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return rawCard(buildImmediateErrorCard(deps.config.locale, ERR.pathValidation(msg)));
  }

  let displayName: string | undefined;
  if (deps.feishuAdapter.getUserDisplayName) {
    try {
      displayName = await deps.feishuAdapter.getUserDisplayName(operatorId);
    } catch (error) {
      log.warn({ chatId, operatorId, err: error instanceof Error ? error.message : String(error) }, "get init operator display name failed");
    }
  }

  const existingTask = initProjectTaskStore.get(chatId);
  if (existingTask?.status === "running") {
    return rawCard(deps.platformOutput.buildInitPendingCard({
      projectName: existingTask.projectName,
      cwd: existingTask.cwd,
      gitUrl: existingTask.gitUrl,
      workBranch: existingTask.workBranch,
      operatorId: existingTask.operatorId,
      displayName,
      duplicate: true,
    }));
  }

  const task: InitProjectTask = {
    taskId: `init-${Date.now().toString(36)}`,
    chatId,
    operatorId,
    messageId: messageId || undefined,
    projectName,
    cwd: sanitized.relative,
    gitUrl: gitUrl || undefined,
    workBranch: workBranch || undefined,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  initProjectTaskStore.set(chatId, task);

  void (async () => {
    try {
      const result = await deps.api.createProject({
        chatId,
        userId: operatorId,
        actorId: operatorId,
        name: projectName,
        cwd: sanitized.absolute,
        gitUrl: gitUrl || undefined,
        gitToken: gitToken || undefined,
        workBranch: workBranch || undefined,
        initialFiles: {
          agentsMd: {
            encoding: "base64",
            contentBase64: encodeUtf8Base64(draft.agentsMdContent),
          },
          gitignore: {
            encoding: "base64",
            contentBase64: encodeUtf8Base64(draft.gitignoreContent),
          },
        },
      });
      log.info({ projectId: result.project?.id, cwd: result.project?.cwd, taskId: task.taskId }, "init_project created");
      clearInitProjectDraft(chatId, operatorId);

      const successCard = deps.platformOutput.buildInitSuccessCard({
        projectName: result.project?.name ?? projectName,
        id: result.project?.id ?? "",
        cwd: sanitized.relative,
        gitUrl: gitUrl ?? "",
        workBranch: workBranch ?? "",
        operatorId,
        displayName
      });
      try {
        await deliverAsyncCardResult(deps, chatId, messageId || undefined, successCard, "async_action_result");
        if (messageId && deps.feishuAdapter.pinMessage) {
          deps.feishuAdapter.pinMessage(messageId).catch((error) => {
            log.warn({ chatId, messageId, err: error instanceof Error ? error.message : String(error) }, "pin init project message failed");
          });
        }
      } catch (uiError) {
        log.warn({ chatId, messageId, taskId: task.taskId, err: uiError instanceof Error ? uiError.message : String(uiError) }, "init project success card update failed");
        notifyLater(deps, chatId, `✅ 项目已创建成功：${result.project?.name ?? projectName}`, {
          label: "notify init project success failed",
          messageId,
        });
      }

      void pushProjectHelpCard(deps, chatId, operatorId).catch((error) => {
        log.warn({ chatId, operatorId, err: error instanceof Error ? error.message : String(error) }, "send init project help card failed");
      });
      if (result.project?.id) {
        void registerExistingChatMembers(deps, chatId, result.project.id);
      }
      initProjectTaskStore.delete(chatId);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      initProjectTaskStore.set(chatId, { ...task, status: "failed", error: msg });
      log.error({ chatId, operatorId, taskId: task.taskId, err: msg }, "init_project async failed");
      const failedCard = deps.platformOutput.buildInitFailedCard({
        projectName,
        cwd: sanitized.relative,
        gitUrl: gitUrl || undefined,
        workBranch: workBranch || undefined,
        operatorId,
        displayName,
        error: msg,
      });
      try {
        await deliverAsyncCardResult(deps, chatId, messageId || undefined, failedCard, "async_action_failure");
      } catch (updateError) {
        log.warn({ chatId, messageId, err: updateError instanceof Error ? updateError.message : String(updateError) }, "update init failed card failed");
        notifyLater(deps, chatId, ERR.projectCreate(msg), {
          label: "notify init project failure failed",
          messageId,
        });
      }
      initProjectTaskStore.delete(chatId);
    }
  })();

  return rawCard(deps.platformOutput.buildInitPendingCard({
    projectName,
    cwd: sanitized.relative,
    gitUrl: gitUrl || undefined,
    workBranch: workBranch || undefined,
    operatorId,
    displayName,
  }));
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
  const backendModelRaw = String(formValues?.backend_model ?? actionValue.backend_model ?? "").trim();

  try {
    const projectId = (await requireProjectByChatId(deps, chatId)).id;
    const firstColon = backendModelRaw.indexOf(":");
    if (firstColon < 0) {
      throw new Error(`invalid backend selection: ${backendModelRaw || "<empty>"}`);
    }
    const backendRaw = backendModelRaw.slice(0, firstColon);
    const remainder = backendModelRaw.slice(firstColon + 1);
    const secondColon = remainder.indexOf(":");
    if (secondColon < 0) {
      throw new Error(`invalid backend selection payload: ${backendModelRaw}`);
    }
    const profileNameRaw = remainder.slice(0, secondColon);
    const model = remainder.slice(secondColon + 1).trim();
    if (!isBackendId(backendRaw)) {
      throw new Error(`invalid backend id: ${backendRaw}`);
    }
    if (!model) {
      throw new Error(`invalid backend selection model: ${backendModelRaw}`);
    }
    const backendId = backendRaw;
    const profileName = profileNameRaw.trim() || undefined;

    void deps.api.createThread({
      projectId,
      userId: operatorId,
      actorId: operatorId,
      threadName,
      backendId,
      model,
      profileName,
    })
      .then((created) => {
        log.info({ threadId: created.threadId, threadName, backend: backendId, model }, "create_thread (async)");
        if (messageId) {
          return resolveHelpThreadCard(deps, chatId, operatorId)
            .then((threadCard) => deliverAsyncCardResult(deps, chatId, messageId, threadCard, "async_action_result"));
        }
        notifyLater(
          deps,
          chatId,
          s.threadCreated(threadName, backendId, model, created.threadId.slice(0, 12)),
          { label: "notify thread created failed", messageId }
        );
        return Promise.resolve();
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ threadName, backend: backendId, transport: transportFor(backendId), err: msg }, "create_thread async failed");
        if (messageId) {
          return deliverAsyncCardResult(deps, chatId, messageId, {
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
          }, "async_action_failure");
        }
        notifyLater(deps, chatId, ERR.threadCreate(msg), {
          label: "notify thread create failed",
          messageId,
        });
        return Promise.resolve();
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
    return rawCard(buildImmediateErrorCard(deps.config.locale, ERR.threadCreate(msg)));
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
  const project = await resolveProjectByChatId(deps.api, chatId);
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
  const turnDetail = await deps.api.getTurnDetail({ projectId: project.id, turnId });
  if (turnDetail?.record.status === "interrupted") {
    return rawCard({
      schema: "2.0",
      header: { title: { tag: "plain_text", content: s.approvalExpiredTitle }, template: "orange" },
      body: {
        elements: [
          { tag: "markdown", content: s.approvalExpiredBody }
        ]
      }
    });
  }
  const mappedDecision = action === "approve" ? "accept" as const
    : action === "deny" ? "decline" as const
    : "approve_always" as const;
  const result = await deps.api.handleApprovalCallback({
    approvalId,
    decision: mappedDecision,
    actorId: operatorId || "unknown-approver",
    includeDisplay: true,
  });
  const approvalResult = typeof result === "string" ? { status: result } : result;
  if (approvalResult.status === "invalid") {
    return rawCard({
      schema: "2.0",
      header: { title: { tag: "plain_text", content: s.approvalInvalidTitle }, template: "red" },
      body: { elements: [{ tag: "markdown", content: s.approvalInvalidBody }] }
    });
  }

  // Build updated card without buttons, showing who acted and when
  const actionLabel = approvalResult.status === "duplicate"
    ? s.approvalDuplicateTitle
    : approvalResult.status === "expired"
      ? s.approvalExpiredTitle
      : action === "approve"
        ? s.approvalApproved
        : action === "deny"
          ? s.approvalRejected
          : s.approvalApprovedOnce;
  const approval = approvalResult.approval;
  const timeStr = formatApprovalTimestamp(approval?.resolvedAt ?? approval?.expiredAt);
  const displayName = approval?.displayName;
  const reason = approval?.reason;
  const cwd = approval?.cwd;
  const statusReason = approval?.statusReason;
  const description = approval?.description ?? "";
  const threadLabel = approval?.threadName ?? "";
  const createdAtLabel = formatApprovalTimestamp(approval?.createdAt);
  const files = approval?.files ?? [];
  const approvalTitle = typeof actionValue.approvalTitle === "string"
    ? actionValue.approvalTitle
    : (actionValue.approvalType === "file_change" ? s.approvalTitleFileChange : s.approvalTitleCommand);
  const approvalTypeLabel = typeof actionValue.approvalTypeLabel === "string"
    ? actionValue.approvalTypeLabel
    : (actionValue.approvalType === "file_change" ? s.approvalTypeFileChange : s.approvalTypeCommand);
  const summary = approval?.summary;
  const summaryBlock = actionValue.approvalType === "command_exec"
    ? (summary ?? description)
    : (summary || description);
  const detailElements: Record<string, unknown>[] = [];

  if (threadLabel) {
    detailElements.push({ tag: "markdown", content: `${s.approvalThreadNameTitle}\n\`${threadLabel}\`` });
  }
  if (displayName) {
    detailElements.push({ tag: "markdown", content: `${s.approvalOperationTitle}\n${displayName}` });
  }
  if (summaryBlock && summaryBlock !== displayName && summaryBlock !== reason) {
    detailElements.push({ tag: "markdown", content: `${s.approvalSummaryTitle}\n> ${summaryBlock.replace(/\n/g, "\n> ")}` });
  }
  if (actionValue.approvalType === "command_exec" && description) {
    detailElements.push({ tag: "markdown", content: `${s.approvalCommandTitleText}\n\`\`\`\n${description}\n\`\`\`` });
  }
  if (reason && reason !== displayName) {
    detailElements.push({ tag: "markdown", content: `${s.approvalReasonTitle}\n${reason}` });
  }
  if (statusReason) {
    detailElements.push({ tag: "markdown", content: `${s.approvalStatusReasonTitle}\n${statusReason}` });
  }
  if (cwd) {
    detailElements.push({ tag: "markdown", content: `${s.approvalWorkingDirectoryTitle}\n\`${cwd}\`` });
  }
  if (files.length > 0) {
    const filePreview = files.slice(0, 5);
    detailElements.push({
      tag: "markdown",
      content: [
        s.approvalFilesTitle,
        ...filePreview.map((file) => `- \`${file}\``),
        files.length > filePreview.length ? `- ${s.approvalMoreFiles(files.length - filePreview.length)}` : null
      ].filter(Boolean).join("\n")
    });
  }

  return rawCard({
    schema: "2.0",
    header: {
      title: { tag: "plain_text", content: approvalTitle },
      subtitle: { tag: "plain_text", content: [threadLabel, createdAtLabel].filter(Boolean).join(" · ") },
      icon: {
        tag: "standard_icon",
        token: actionValue.approvalType === "file_change" ? "file-detail_outlined" : "safe_outlined",
        color: approvalResult.status === "expired" || approvalResult.status === "duplicate"
          ? "orange"
          : action === "deny" ? "red" : "green"
      },
      text_tag_list: [
        {
          tag: "text_tag",
          text: { tag: "plain_text", content: actionLabel.replace(/[✅❌]\s*/, "") },
          color: approvalResult.status === "expired" || approvalResult.status === "duplicate"
            ? "orange"
            : action === "deny" ? "red" : "green"
        },
        { tag: "text_tag", text: { tag: "plain_text", content: approvalTypeLabel }, color: "neutral" }
      ],
      template: approvalResult.status === "expired" || approvalResult.status === "duplicate"
        ? "orange"
        : action === "deny" ? "red" : "green"
    },
    body: {
      direction: "vertical",
      vertical_spacing: "8px",
      padding: "8px 12px 12px 12px",
      elements: [
        ...detailElements.flatMap((element, index) => index === detailElements.length - 1 ? [element] : [element, { tag: "hr" }]),
        ...(detailElements.length > 0 ? [{ tag: "hr" }] : []),
        { tag: "markdown", content: `${s.approvalResultTitle}\n${actionLabel}${approval?.actorId ? `  ·  <at id=${approval.actorId}></at>` : ""}` },
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
    return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
  }

  try {
    const fromHelp = actionValue.fromHelp === true;
    const projectId = (await requireProjectByChatId(deps, chatId)).id;
    if (action === "switch_thread") {
      const threadName = String(actionValue.threadName ?? "");
      if (!threadName) {
        return;
      }
      // Update binding — pool is keyed by threadName, no release needed
      await deps.api.joinThread({ projectId, userId, actorId: userId, threadName });
      const activeBinding = await deps.api.getUserActiveThread({ projectId, userId });
      const threads = await deps.api.listThreads({ projectId, actorId: userId });
      const displayName = getCachedDisplayName(deps, userId);
      const items = threads.map((thread) => ({
        threadName: thread.threadName,
        threadId: thread.threadId,
        status: thread.status,
        backendName: thread.backendId,
        modelName: thread.model,
        active: thread.status === "active" && activeBinding?.threadId === thread.threadId
      }));
      return rawCard(
        fromHelp
          ? deps.platformOutput.buildHelpThreadCard(items, userId, displayName, false)
          : deps.platformOutput.buildThreadListCard(items, userId, displayName, false)
      );
    }

    // switch_to_main: leave thread, keep old thread's API alive
    await deps.api.leaveThread({ projectId, userId, actorId: userId });
    log.info("switch_to_main: binding cleared, threads stay alive");
    const threads = await deps.api.listThreads({ projectId, actorId: userId });
    const displayName = getCachedDisplayName(deps, userId);
    const items = threads.map((thread) => ({
      threadName: thread.threadName,
      threadId: thread.threadId,
      status: thread.status,
      backendName: thread.backendId,
      modelName: thread.model,
      active: false
    }));
    return rawCard(
      fromHelp
        ? deps.platformOutput.buildHelpThreadCard(items, userId, displayName, true)
        : deps.platformOutput.buildThreadListCard(items, userId, displayName, true)
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return rawCard(buildImmediateErrorCard(deps.config.locale, ERR.switchFailed(msg)));
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
      const mergeResult = await deps.api.handleMergeConfirm({ projectId: (await requireProjectByChatId(deps, chatId)).id, branchName, actorId: context?.userId ?? "system", context });
      const project = await resolveProjectByChatId(deps.api, chatId);
      if (mergeResult.kind === "success" && project?.id) {
        return rawCard(
          deps.platformOutput.buildMergeResultCard(
            branchName,
            baseBranch,
            true,
            mergeResult.message ?? "",
            undefined,
            { projectId: project.id, chatId }
          )
        );
      }
      return await renderMergeResultCard(deps, chatId, branchName, baseBranch, mergeResult);
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
    return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NOT_YOUR_CARD));
  }
  const turnId = String(actionValue.turnId ?? "");
  const threadId = String(actionValue.threadId ?? "");
  if (!turnId) {
    return;
  }
  try {
    const projectId = (await requireProjectByChatId(deps, chatId)).id;
    const { snapshot, contextReset } = await deps.api.jumpToSnapshot({ projectId, targetTurnId: turnId, userId });
    if (contextReset) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      notifyLater(deps, chatId, s.snapshotContextReset(snapshot.turnIndex), {
        label: "notify snapshot context reset failed",
      });
    }
    const allSnapshots = await deps.api.listSnapshots({ projectId, threadId: threadId || snapshot.threadId });
    const displayName = getCachedDisplayName(deps, userId);
    const effectiveThreadId = threadId || snapshot.threadId;
    const resolvedBinding = await deps.api.getUserActiveThread({ projectId: (await requireProjectByChatId(deps, chatId)).id, userId });
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
    return rawCard(buildAsyncFailureCard(
      deps.config.locale,
      getFeishuCardHandlerStrings(deps.config.locale).asyncJumpSnapshotFailedTitle,
      msg,
      { subtitle: turnId }
    ));
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
    const project = await resolveProjectByChatId(deps.api, chatId);
    const def = await deps.api.installSkill({ source: skillName, projectId: project?.id, actorId: "system" });
    await deps.platformOutput.sendSkillOperation(chatId, {
      kind: "skill_operation",
      action: "installed",
      skill: { name: def.name ?? skillName, description: def.description ?? "", installed: true }
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

async function buildAdminProjectData(deps: FeishuHandlerDeps): Promise<import("../../services/event/im-output").IMAdminProjectPanel> {
  const projects = await deps.api.listProjects();
  const workspace = deps.config.cwd;
  const projectData = await Promise.all(projects.map(async (p) => {
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
      memberCount: (await deps.api.listProjectMembers(p.id)).length
    };
  }));
  return {
    kind: "admin_project" as const,
    projects: projectData
  };
}

async function buildAdminMemberData(deps: FeishuHandlerDeps): Promise<import("../../services/event/im-output").IMAdminMemberPanel> {
  const allProjects = await deps.api.listProjects();
  const projects = await Promise.all(allProjects.map(async p => {
    const rawMembers = await deps.api.listProjectMembers(p.id);
    const members = rawMembers.map((m) => ({
      userId: m.userId,
      displayName: getCachedDisplayName(deps, m.userId),
      role: m.role
    }));
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

async function buildAdminUserData(deps: FeishuHandlerDeps, page = 0): Promise<import("../../services/event/im-output").IMAdminUserPanel> {
  const { users, total } = await deps.api.listUsers({ offset: page * USER_PAGE_SIZE, limit: USER_PAGE_SIZE });
  const enriched = users.map((u) => ({
    userId: u.userId,
    displayName: getCachedDisplayName(deps, u.userId),
    sysRole: u.sysRole === "admin" ? 1 as const : 0 as const,
    source: u.source as "env" | "im"
  }));
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
): Promise<import("../../services/event/im-output").IMAdminSkillPanel> {
  const project = chatId ? await resolveProjectByChatId(deps.api, chatId) : null;
  const projectId = project?.id;
  const catalogEntries = (await deps.api.listSkillCatalog?.()) ?? [];
  const catalogByName = new Map(catalogEntries.map((entry) => [entry.pluginName, entry]));
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
    ? (await (deps.api.listProjectSkills?.(projectId) ?? [])).map((plugin) => {
      const pluginName = plugin.name ?? "unknown";
      const catalog = catalogByName.get(pluginName);
      return {
        pluginName,
        sourceType: String(catalog?.sourceType ?? "project"),
        name: plugin.name ?? pluginName,
        description: plugin.description ?? "",
        downloaded: true,
        enabled: !!plugin.enabled,
        mcpServers: [],
        addedBy: typeof catalog?.downloadedBy === "string" ? catalog.downloadedBy : undefined,
        downloadedAt: typeof catalog?.downloadedAt === "string" ? catalog.downloadedAt : undefined,
      };
    })
    : (await deps.api.listSkills()).map((plugin) => {
      const pluginName = plugin.name ?? "unknown";
      const catalog = catalogByName.get(pluginName);
      return {
        pluginName,
        sourceType: String(catalog?.sourceType ?? "github-subpath"),
        name: pluginName,
        description: plugin.description ?? "",
        downloaded: true,
        enabled: false,
        mcpServers: [],
        addedBy: typeof catalog?.downloadedBy === "string" ? catalog.downloadedBy : undefined,
        downloadedAt: typeof catalog?.downloadedAt === "string" ? catalog.downloadedAt : undefined,
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

async function buildAdminBackendData(deps: FeishuHandlerDeps): Promise<import("../../services/event/im-output").IMAdminBackendPanel> {
  const configs = await deps.api.readBackendConfigs();
  return {
    kind: "admin_backend",
    backends: configs.map((c) => ({
      name: c.name,
      serverCmd: c.serverCmd,
      cmdAvailable: c.cmdAvailable,
      configPath: "",
      configExists: true,
      activeProvider: c.activeProvider,
      policy: c.policy,
      providers: c.providers.map((p) => ({
        name: p.name,
        baseUrl: undefined,
        apiKeyEnv: undefined,
        apiKeySet: p.apiKeySet,
        isActive: c.activeProvider === p.name,
        models: p.models.map((m) => ({
          name: m.name,
          available: m.available,
          checkedAt: m.checkedAt,
          isCurrent: false
        }))
      })),
      // Derive profiles from unified providers[].models[]
      profiles: c.providers.flatMap((p) =>
        p.models.map((m) => ({ name: m.name, model: m.name, provider: p.name, extras: {} }))
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

  const project = await resolveProjectByChatId(deps.api, chatId);
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
      if (!deps.api.installFromGithub) throw new Error(s.githubSubpathImportUnavailable);
      await deps.api.installFromGithub({
        repoUrl: source,
        skillSubpath,
        pluginName,
        actorId: operatorId,
        autoEnableProjectId: autoEnable === "project" ? project?.id : undefined,
      });

      updateInstallTask(chatId, taskId, { status: "success", detail: s.installTaskDownloaded });
      log.info({ chatId, operatorId, taskId, installMode, source, pluginName }, "admin_skill_install_succeeded");
      const card = deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId));
      await deliverAsyncCardResult(deps, chatId, messageId || undefined, card, "async_action_result");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateInstallTask(chatId, taskId, { status: "failed", detail: msg });
      log.error({ chatId, operatorId, taskId, installMode, source, pluginName, err: msg }, "admin_skill_install_failed");
      const card = deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId));
      await deliverAsyncCardResult(deps, chatId, messageId || undefined, card, "async_action_failure");
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
  const project = await resolveProjectByChatId(deps.api, chatId);
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
    if (!deps.api.installFromLocalSource) throw new Error(s.localSkillImportUnavailable);
    if (!deps.api.validateSkillNameCandidate) throw new Error(s.skillNameValidationUnavailable);
    const formValues = payload.action?.form_value ?? {};
    const finalPluginName = String(formValues.skill_name ?? "").trim() || staged.pluginName;
    const validation = await deps.api.validateSkillNameCandidate(finalPluginName);
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
            projectName: staged.autoEnableProjectId ? (await resolveProjectByChatId(deps.api, chatId))?.name : undefined,
            expiresHint: s.skillInstallExpiresHint,
            validationError: validation.reason ?? s.invalidSkillName,
          })
          : deps.platformOutput.buildAdminSkillCard(await buildAdminSkillData(deps, chatId))
      );
    }
    consumeStagedFeishuSkillInstall(chatId, operatorId);
    await deps.api.installFromLocalSource({
      localPath: staged.localPath,
      pluginName: validation.normalizedName,
      actorId: operatorId,
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
  const project = await resolveProjectByChatId(deps.api, chatId);

  try {
    const result = await feishuActionRouter.route(deps, action);
    log.info({
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
      actionLog.info({ actionKind: action.kind }, "card action authorization denied");
      return rawCard(buildImmediateErrorCard(deps.config.locale, GUARD.NO_PERMISSION));
    }
    actionLog.error({ err: error instanceof Error ? error.message : error }, "card action error");
    if (error instanceof TurnRecoveryError) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      return rawCard(buildAsyncFailureCard(
        deps.config.locale,
        s.turnRecoveryFailed("Turn", error.meta.turnId, error.meta.projectId, error.meta.chatId),
        error.message,
        { subtitle: error.meta.turnId }
      ));
    }
    log.info({
      projectId: project?.id ?? "unknown",
      actorId: operatorId,
      action: `card_action:${actionId}`,
      result: "error",
      traceId: messageId || undefined,
      correlationId: messageId || undefined,
      detailJson: { chatId, error: error instanceof Error ? error.message : String(error), actionKind: action.kind }
    });
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    return rawCard(buildImmediateErrorCard(
      deps.config.locale,
      s.genericError(error instanceof Error ? error.message : String(error))
    ));
  }
}
