/**
 * @module packages/channel-feishu/src/feishu-output-adapter
 * @layer platform (src/feishu/)
 *
 * FeishuOutputAdapter — thin router implementing IMOutputAdapter.
 *
 * Delegates to:
 * - TurnCardManager  → streaming turn card state and rendering (Path B)
 * - Card Builders    → static card JSON builders (Path A)
 * - FeishuAdapter    → Feishu API calls (send/update)
 *
 * Import constraints:
 * - May import: packages/*, services/*
 * - Must NOT import: src/feishu/, src/slack/
 */
import {
  type IMApprovalRequest,
  type IMConfigOperation,
  type IMNotification,
  type IMPlanUpdate,
  type IMProgressEvent,
  type IMSkillOperation,
  type IMSnapshotOperation,
  type IMThreadCreatedResult,
  type IMThreadNewFormData,
  type IMThreadOperation,
  type IMToolOutputChunk,
  type IMTurnSummary,
  type IMUserInputRequest,
  type IMThreadMergeOperation,
  type IMAdminProjectPanel,
  type IMAdminMemberPanel,
  type IMAdminSkillPanel,
  type IMAdminBackendPanel,
  type TurnStatus,
} from "../../../services/index";
import { createLogger } from "../../logging";
import { DEFAULT_APP_LOCALE, type AppLocale } from "../../common/app-locale";
import { getApprovalCwd, getApprovalDisplayName, getApprovalFiles, getApprovalReason, getApprovalSummary } from "../../common/approval-display";
import { MAIN_THREAD_NAME } from "../../common/thread-constants";

import { getFeishuOutputAdapterStrings } from "./feishu-output-adapter.strings";
import { TurnCardManager, type TurnCardMessageClient } from "./feishu-turn-card";
import type { TurnCardReader } from "../../common/types";
import {
  buildThreadListCard,
  buildMergePreviewCard,
  buildMergeResultCard,
  buildSnapshotHistoryCard,
  buildThreadCreatedCard,
  buildThreadNewCard,
  buildModelListCard,
  buildInitCard,
  buildInitBindMenuCard,
  buildInitCreateMenuCard,
  buildInitProjectFileEditorCard,
  buildInitPendingCard,
  buildInitFailedCard,
  buildInitSuccessCard,
  buildProjectResumedCard,
  buildHelpCard,
  buildHelpProjectCard,
  buildHelpThreadCard,
  buildHelpThreadNewCard,
  buildHelpMergeCard,
  buildHelpSkillCard,
  buildHelpBackendCard,
  buildAdminHelpCard,
  buildAdminProjectCard,
  buildAdminProjectEditCard,
  buildAdminUserCard,
  buildAdminMemberCard,
  buildAdminSkillCard,
  buildAdminSkillInstallCard,
  buildAdminSkillFileInstallCard,
  buildAdminSkillFileConfirmCard,
  buildAdminBackendCard,
  buildAdminBackendEditCard,
  buildAdminBackendModelCard,
  buildAdminBackendPolicyCard,
  buildAdminBackendAddProviderCard,
  buildTurnHistoryCard,
  buildFileReviewCard,
  buildMergeRecoveryRequiredCard,
  buildMergeFileDetailCard,
  buildMergeAgentAssistCard,
  buildMergeSummaryCard,
} from "./feishu-card-builders";

// Re-export card builders for external consumers (card-handler, tests)
export {
  buildThreadListCard,
  buildMergePreviewCard,
  buildMergeResultCard,
  buildSnapshotHistoryCard,
  buildThreadCreatedCard,
  buildThreadNewCard,
  buildModelListCard,
  buildInitCard,
  buildInitBindMenuCard,
  buildInitCreateMenuCard,
  buildInitProjectFileEditorCard,
  buildInitPendingCard,
  buildInitFailedCard,
  buildInitSuccessCard,
  buildProjectResumedCard,
  buildHelpCard,
  buildHelpProjectCard,
  buildHelpThreadCard,
  buildHelpThreadNewCard,
  buildHelpMergeCard,
  buildHelpSkillCard,
  buildHelpBackendCard,
  buildAdminHelpCard,
  buildAdminProjectCard,
  buildAdminProjectEditCard,
  buildAdminMemberCard,
  buildAdminSkillCard,
  buildAdminSkillInstallCard,
  buildAdminSkillFileInstallCard,
  buildAdminSkillFileConfirmCard,
  buildAdminBackendCard,
  buildAdminBackendEditCard,
  buildAdminBackendModelCard,
  buildAdminBackendPolicyCard,
  buildAdminBackendAddProviderCard,
  buildTurnHistoryCard,
  buildFileReviewCard,
  buildMergeRecoveryRequiredCard,
  buildMergeFileDetailCard,
  buildMergeAgentAssistCard,
  buildMergeSummaryCard,
} from "./feishu-card-builders";

// ── Client interface (subset of FeishuAdapter) ──────────────────────────────

interface FeishuMessageClient extends TurnCardMessageClient {
  getUserDisplayName?(userId: string): Promise<string>;
}

// ── FeishuOutputAdapter ─────────────────────────────────────────────────────

export class FeishuOutputAdapter {
  private readonly turnCard: TurnCardManager;
  private readonly log = createLogger("output");
  private readonly locale: AppLocale;

  constructor(
    private readonly client: FeishuMessageClient,
    options?: {
      cardThrottleMs?: number;
      turnCardReader?: TurnCardReader;
      locale?: AppLocale;
      deliveryMode?: "static" | "stream";
    }
  ) {
    this.locale = options?.locale ?? DEFAULT_APP_LOCALE;
    this.turnCard = new TurnCardManager(client, { ...options, locale: this.locale });
  }

  // ── onTurnComplete callback passthrough ────────────────────────────────

  get onTurnComplete() { return this.turnCard.onTurnComplete; }
  set onTurnComplete(cb: ((chatId: string, summary: IMTurnSummary) => void) | undefined) {
    this.turnCard.onTurnComplete = cb;
  }

  // ── Per-turn metadata (replaces singleton setBackendName/setModelName) ──

  /** Set per-turn backend/model info — stored on the turn's own state, not shared. */
  setCardBackendInfo(chatId: string, turnId: string, backendName: string, modelName: string): void {
    this.turnCard.setCardBackendInfo(chatId, turnId, backendName, modelName);
  }

  /** Set per-turn mode (plan vs default agent mode). */
  setCardTurnMode(chatId: string, turnId: string, mode: "plan"): void {
    this.turnCard.setCardTurnMode(chatId, turnId, mode);
  }

  /** Set per-turn prompt summary from user's prompt text. */
  setCardPromptSummary(chatId: string, turnId: string, promptText: string): void {
    this.turnCard.setCardPromptSummary(chatId, turnId, promptText);
  }

  async initializeTurnCard(chatId: string, turnId: string): Promise<void> {
    await this.turnCard.initializeTurnCard(chatId, turnId);
  }

  /** Set thread name on a turn card early (before completeTurn). */
  setCardThreadName(chatId: string, turnId: string, threadName: string, turnNumber?: number): void {
    this.turnCard.setCardThreadName(chatId, turnId, threadName, turnNumber);
  }

  // ── AgentStreamOutput methods (Path B: streaming events) ───────────────

  async appendContent(chatId: string, turnId: string, delta: string): Promise<void> {
    this.turnCard.appendContent(chatId, turnId, delta);
  }

  async appendReasoning(chatId: string, turnId: string, delta: string): Promise<void> {
    this.turnCard.appendReasoning(chatId, turnId, delta);
  }

  async appendPlan(chatId: string, turnId: string, delta: string): Promise<void> {
    this.turnCard.appendPlan(chatId, turnId, delta);
  }

  async updatePlan(chatId: string, update: IMPlanUpdate): Promise<void> {
    await this.turnCard.updatePlan(chatId, update);
  }

  async appendToolOutput(chatId: string, chunk: IMToolOutputChunk): Promise<void> {
    this.turnCard.appendToolOutput(chatId, chunk);
  }

  async updateProgress(chatId: string, event: IMProgressEvent): Promise<void> {
    await this.turnCard.updateProgress(chatId, event);
  }

  private formatApprovalTime(value?: string): string {
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

  private approvalTitle(req: IMApprovalRequest): string {
    const s = getFeishuOutputAdapterStrings(this.locale);
    return req.approvalType === "command_exec" ? s.approvalCommandTitle : s.approvalPatchTitle;
  }

  private approvalTypeLabel(req: IMApprovalRequest): string {
    const s = getFeishuOutputAdapterStrings(this.locale);
    return req.approvalType === "command_exec" ? s.approvalCommandType : s.approvalPatchType;
  }

  private approvalSummary(req: IMApprovalRequest): string {
    const s = getFeishuOutputAdapterStrings(this.locale);
    return getApprovalSummary(req, (count) => s.approvalFilesAffected(count));
  }

  private approvalTip(content: string): Record<string, unknown> {
    return {
      tag: "div",
      text: { tag: "plain_text", content, text_size: "notation", text_color: "grey" }
    };
  }

  async requestApproval(chatId: string, req: IMApprovalRequest): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    const TRUNCATE_THRESHOLD = 200;
    const desc = req.description;

    // Extract first meaningful line as summary (e.g. "Command approval: cat > path/file.py <<'PY'")
    const firstLine = desc.split("\n")[0] ?? desc;
    const commandSummary = firstLine.length > TRUNCATE_THRESHOLD
      ? firstLine.slice(0, TRUNCATE_THRESHOLD) + "…"
      : firstLine;

    const isLong = desc.length > TRUNCATE_THRESHOLD;
    // Enrich turnNumber from TurnCardManager cached state (turn card is created before approval events)
    const turnNumber = req.turnNumber ?? this.turnCard.getCachedState(chatId, req.turnId)?.turnNumber;
    const threadLabel = req.threadName || req.threadId;
    const subtitleLabel = turnNumber != null
      ? `${threadLabel} · Turn ${turnNumber}`
      : threadLabel;
    const createdAtLabel = this.formatApprovalTime(req.createdAt);
    const changedFiles = getApprovalFiles(req);
    const filePreview = changedFiles.slice(0, 3);
    const callbackFilePreview = changedFiles.slice(0, 5);
    const displayName = getApprovalDisplayName(req);
    const summary = this.approvalSummary(req);
    const reason = getApprovalReason(req);
    const cwd = getApprovalCwd(req);
    const callbackDescription = desc.length > TRUNCATE_THRESHOLD
      ? desc.slice(0, TRUNCATE_THRESHOLD) + "…"
      : desc;

    const contentElements: Record<string, unknown>[] = [
      {
        tag: "column_set", flex_mode: "none", background_style: "default",
        columns: [
          {
            tag: "column", width: "weighted", weight: 1,
            elements: [
              { tag: "markdown", content: s.threadLabel(threadLabel) },
              { tag: "markdown", content: `**${s.approvalCreatedAt}**  ${createdAtLabel}` }
            ]
          },
          {
            tag: "column", width: "weighted", weight: 1,
            elements: [
              { tag: "markdown", content: `**${s.approvalType}**  ${this.approvalTypeLabel(req)}` }
            ]
          }
        ]
      },
      { tag: "hr" },
    ];

    if (displayName) {
      contentElements.push({
        tag: "markdown",
        content: `**${s.approvalOperationName}**\n${displayName}`
      });
    }

    contentElements.push({
      tag: "markdown",
      content: `**${s.approvalPendingSummary}**\n> ${req.approvalType === "command_exec"
        ? (summary || (isLong ? commandSummary : desc))
        : summary}`
    });

    if (reason && reason !== summary && reason !== displayName) {
      contentElements.push({
        tag: "markdown",
        content: `**${s.approvalReason}**\n${reason}`
      });
    }

    if (cwd) {
      contentElements.push({
        tag: "markdown",
        content: `**${s.approvalWorkingDirectory}**\n\`${cwd}\``
      });
    }

    if (req.approvalType === "file_change" && filePreview.length > 0) {
      contentElements.push({
        tag: "markdown",
        content: [
          `**${s.approvalFilesTitle}**`,
          ...filePreview.map((file) => `- \`${file}\``),
          changedFiles.length > filePreview.length ? `- ${s.approvalMoreFiles(changedFiles.length - filePreview.length)}` : null
        ].filter(Boolean).join("\n")
      });
    }

    if (req.approvalType === "file_change" && desc && desc !== s.approvalFileChangeDefaultDescription) {
      contentElements.push(this.approvalTip(desc));
    }

    if (req.approvalType === "command_exec") {
      contentElements.push({
        tag: "collapsible_panel",
        expanded: false,
        header: {
          title: { tag: "plain_text", content: s.approvalCommandDetails },
          icon: { tag: "standard_icon", token: "expand-down_outlined", color: "grey", size: "16px 16px" },
          icon_position: "follow_text",
          icon_expanded_angle: -180
        },
        vertical_spacing: "2px",
        border: { color: "grey" },
        elements: [
          { tag: "markdown", content: "```\n" + desc + "\n```" }
        ]
      });
    }

    contentElements.push({ tag: "hr" });
    contentElements.push({
      tag: "column_set", flex_mode: "flow", background_style: "default",
      columns: req.availableActions.map((action) => ({
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{
          tag: "button",
          text: {
            tag: "plain_text",
            content: action === "approve" ? s.approvalApprove
              : action === "deny" ? s.approvalDeny
                : action === "approve_always" ? s.approvalApproveAlways
                  : action
          },
          ...(action === "approve" ? { type: "primary" } : {}),
          ...(action === "deny" ? { type: "default" } : {}),
          behaviors: [{
            type: "callback",
            value: {
              action,
              approvalId: req.approvalId,
              callId: req.callId,
              threadId: req.threadId,
              turnId: req.turnId,
              commandSummary,
              threadLabel,
              createdAtLabel,
              approvalType: req.approvalType,
              approvalTitle: this.approvalTitle(req),
              approvalTypeLabel: this.approvalTypeLabel(req),
              displayName,
              summary,
              reason,
              cwd,
              description: callbackDescription,
              files: callbackFilePreview
            }
          }]
        }]
      }))
    });

    contentElements.push(
      this.approvalTip(
        req.availableActions.includes("approve_always")
          ? s.approvalAlwaysTip
          : s.approvalCheckTip
      )
    );

    await this.client.sendInteractiveCard(chatId, {
      schema: "2.0",
      header: {
        title: { tag: "plain_text", content: this.approvalTitle(req) },
        subtitle: { tag: "plain_text", content: s.approvalSubtitle(subtitleLabel, createdAtLabel) },
        icon: {
          tag: "standard_icon",
          token: req.approvalType === "command_exec" ? "safe_outlined" : "file-detail_outlined",
          color: req.approvalType === "command_exec" ? "orange" : "wathet"
        },
        text_tag_list: [
          { tag: "text_tag", text: { tag: "plain_text", content: s.approvalPendingTag }, color: "orange" },
          { tag: "text_tag", text: { tag: "plain_text", content: this.approvalTypeLabel(req) }, color: "neutral" }
        ],
        template: req.approvalType === "command_exec" ? "orange" : "wathet"
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "8px 12px 12px 12px",
        elements: contentElements
      }
    });
  }

  async requestUserInput(chatId: string, req: IMUserInputRequest): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    const elements: Record<string, unknown>[] = [];
    const threadLabel = req.threadName || req.threadId || s.currentThreadLabel;

    elements.push({
      tag: "column_set", flex_mode: "none", background_style: "default",
      columns: [
        {
          tag: "column", width: "weighted", weight: 1,
          elements: [
            { tag: "markdown", content: s.threadCodeLabel(threadLabel) },
            { tag: "markdown", content: s.turnLabel(req.turnId) }
          ]
        },
        {
          tag: "column", width: "weighted", weight: 1,
          elements: [
            { tag: "markdown", content: `**${s.questionCount(req.questions.length)}**` },
            { tag: "markdown", content: `**${s.interactionPlanConfirm}**` }
          ]
        }
      ]
    });
    elements.push({ tag: "hr" });

    for (let i = 0; i < req.questions.length; i++) {
      const question = req.questions[i]!;
      elements.push({ tag: "markdown", content: `**${s.questionTitle(i + 1)}**\n${question.text}` });

      if (question.options?.length) {
        // Radio-style dropdown for each question
        const options = question.options.map((opt, optIdx) => ({
          text: { tag: "plain_text" as const, content: opt },
          value: opt
        }));
        // Default to first option or one marked "Recommended"
        const recommendedIdx = question.options.findIndex(o => o.includes("Recommended"));
        const defaultValue = recommendedIdx >= 0 ? question.options[recommendedIdx]! : question.options[0]!;
        elements.push({
          tag: "select_static",
          placeholder: { tag: "plain_text", content: s.choosePlease },
          options,
          initial_option: defaultValue,
          value: { key: `q_${i}` }
        });
        elements.push(this.approvalTip(s.chooseRecommendedTip));
      }

      if (i < req.questions.length - 1) {
        elements.push({ tag: "hr" });
      }
    }

    // Metadata for callback — embed question IDs so handler can map answers
    const questionMeta = req.questions.map((q, i) => ({
      idx: i,
      id: q.id ?? q.text,
      defaultAnswer: q.options?.[q.options.findIndex(o => o.includes("Recommended"))] ?? q.options?.[0] ?? ""
    }));

    elements.push({ tag: "hr" });
    elements.push({
      tag: "column_set", flex_mode: "flow", background_style: "default",
      columns: [{
        tag: "column", width: "auto", vertical_align: "center",
        elements: [{
          tag: "button",
          text: { tag: "plain_text", content: s.submitConfirm },
          type: "primary",
          width: "default",
          behaviors: [{
            type: "callback",
            value: {
              action: "user_input_submit",
              callId: req.callId,
              turnId: req.turnId,
              threadName: req.threadName ?? "",
              questionMeta: JSON.stringify(questionMeta)
            }
          }]
        }]
      }]
    });
    elements.push(this.approvalTip(s.submitPlanTip));

    await this.client.sendInteractiveCard(chatId, {
      schema: "2.0",
      config: { width_mode: "fill" },
      header: {
        title: { tag: "plain_text", content: s.planModeNeedChoice },
        subtitle: { tag: "plain_text", content: `${threadLabel} · ${req.turnId}` },
        icon: { tag: "standard_icon", token: "app_outlined", color: "blue" },
        text_tag_list: [
          { tag: "text_tag", text: { tag: "plain_text", content: s.pendingConfirm }, color: "blue" },
          { tag: "text_tag", text: { tag: "plain_text", content: s.planModeTag }, color: "neutral" }
        ],
        template: "blue"
      },
      body: {
        direction: "vertical",
        vertical_spacing: "8px",
        padding: "8px 12px 12px 12px",
        elements
      }
    });
  }

  async notify(chatId: string, notif: IMNotification): Promise<void> {
    if (!notif.turnId) {
      await this.client.sendMessage({ chatId, text: notif.title });
      return;
    }
    const result = await this.turnCard.handleNotify(chatId, notif);
    if (result === "passthrough") {
      await this.client.sendMessage({ chatId, text: notif.title });
    }
  }

  async completeTurn(chatId: string, summary: IMTurnSummary): Promise<void> {
    await this.turnCard.completeTurn(chatId, summary);
  }

  // ── Card action (accept/revert/interrupt) ──────────────────────────────

  async updateCardAction(
    chatId: string,
    turnId: string,
    action: "accepted" | "reverted" | "interrupting" | "interrupted",
    meta?: { actorName?: string; requestedAt?: string }
  ): Promise<Record<string, unknown> | null> {
    return this.turnCard.updateCardAction(chatId, turnId, action, meta);
  }

  prepareInterruptingCard(
    chatId: string,
    turnId: string,
    meta?: { actorName?: string; requestedAt?: string }
  ): Record<string, unknown> | null {
    return this.turnCard.prepareInterruptingCard(chatId, turnId, meta);
  }

  async finalizeInterruptAction(chatId: string, turnId: string): Promise<void> {
    await this.turnCard.finalizeInterruptAction(chatId, turnId);
  }

  async cancelInterruptingCard(chatId: string, turnId: string): Promise<void> {
    await this.turnCard.cancelInterruptingCard(chatId, turnId);
  }

  renderCurrentTurnCard(chatId: string, turnId: string): Record<string, unknown> | null {
    const state = this.turnCard.getCachedState(chatId, turnId);
    if (!state) return null;
    return this.turnCard.renderCard(state);
  }

  // ── Sub-page rendering (for card-handler callbacks) ────────────────────

  /** Render paginated file changes detail card from persisted state. */
  renderFileChangesCard(chatId: string, turnId: string, page: number): Record<string, unknown> | null {
    const state = this.turnCard.getCachedState(chatId, turnId);
    if (!state) return null;
    return this.turnCard.renderFileChangesCard(state, page);
  }

  /** Render paginated tool progress detail card from persisted state. */
  renderToolProgressCard(chatId: string, turnId: string, page: number): Record<string, unknown> | null {
    const state = this.turnCard.getCachedState(chatId, turnId);
    if (!state) return null;
    return this.turnCard.renderToolProgressCard(state, page);
  }

  primeHistoricalTurnCard(input: {
    chatId: string;
    turnId: string;
    status: TurnStatus;
    threadName?: string;
    turnNumber?: number;
    backendName?: string;
    modelName?: string;
    thinking?: string;
    message?: string;
    tools?: Array<{ label: string; tool: string; callId?: string; status: "running" | "completed" | "failed"; targetFile?: string }>;
    fileChanges: Array<{ filesChanged: string[]; diffSummary: string; stats?: { additions: number; deletions: number }; diffFiles?: Array<{ file: string; status: "new" | "modified" | "deleted"; additions: number; deletions: number }>; diffSegments?: Array<{ file: string; status: "new" | "modified" | "deleted"; additions: number; deletions: number; content: string }> }>;
    toolOutputs?: Array<{ callId: string; command: string; output: string }>;
    planState?: { explanation?: string; items: Array<{ step: string; status: "pending" | "in_progress" | "completed" }> };
    tokenUsage?: { input: number; output: number; total?: number };
    promptSummary?: string;
    agentNote?: string;
    actionTaken?: "accepted" | "reverted" | "interrupting" | "interrupted";
    interruptedBy?: string;
    interruptRequestedAt?: string;
    interruptedAt?: string;
    turnMode?: "plan";
  }): Record<string, unknown> {
    const state = this.turnCard.cacheHistoricalState(input);
    return this.turnCard.renderCard(state);
  }

  getTurnCardThreadName(chatId: string, turnId: string): string | undefined {
    return this.turnCard.getTurnCardThreadName(chatId, turnId);
  }

  // ── IMOutputAdapter management methods (Path A: command responses) ─────

  async sendThreadOperation(chatId: string, op: IMThreadOperation, userId?: string): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    if (op.action === "listed") {
      const threads = op.threads ?? [];
      if (threads.length === 0) {
        await this.client.sendMessage({ chatId, text: s.emptyThreadList });
        return;
      }
      const displayName = userId && this.client.getUserDisplayName
        ? await this.client.getUserDisplayName(userId)
        : userId;
      const isOnMain = !threads.some((t) => t.active);
      const card = buildThreadListCard(threads, userId, displayName, isOnMain, this.locale);
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "created" && op.thread) {
      await this.client.sendMessage({ chatId, text: s.threadCreated(op.thread.threadName, op.thread.threadId.slice(0, 8)) });
      return;
    }

    if ((op.action === "joined" || op.action === "resumed") && op.thread) {
      await this.client.sendMessage({ chatId, text: s.threadSwitched(op.thread.threadName) });
      return;
    }

    if (op.action === "left") {
      await this.client.sendMessage({ chatId, text: s.threadLeft });
    }
  }

  async sendSnapshotOperation(chatId: string, op: IMSnapshotOperation, userId?: string): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    if (op.action === "listed") {
      const snapshots = op.snapshots ?? [];
      if (snapshots.length === 0) {
        await this.client.sendMessage({ chatId, text: s.snapshotEmpty });
        return;
      }
      const threadId = op.threadId ?? "";
      const threadName = op.threadName;
      const displayName = userId && this.client.getUserDisplayName
        ? await this.client.getUserDisplayName(userId)
        : userId;
      const card = buildSnapshotHistoryCard(snapshots, threadId, userId, displayName, threadName, undefined, this.locale);
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "jumped" && op.target) {
      await this.client.sendMessage({
        chatId,
        text: s.snapshotJumped(op.target.turnIndex, op.target.agentSummary ?? "", op.contextReset === true)
      });
    }
  }

  async sendConfigOperation(chatId: string, op: IMConfigOperation, userId?: string): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    if (op.action === "model_list") {
      const currentModel = op.currentModel ?? "";
      const models = op.availableModels ?? [currentModel];
      const card = buildModelListCard(currentModel, models, op.threadName, userId, this.locale);
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "model_set" && op.currentModel) {
      // NOTE: No longer mutating singleton modelName — model info is per-thread/per-turn
      await this.client.sendMessage({
        chatId,
        text: s.modelSet(op.currentModel)
      });
    }
  }

  async sendThreadNewForm(chatId: string, data: IMThreadNewFormData): Promise<void> {
    const card = buildThreadNewCard(data.catalog, this.locale);
    await this.client.sendInteractiveCard(chatId, card);
  }

  async sendThreadCreated(chatId: string, result: IMThreadCreatedResult): Promise<void> {
    const card = buildThreadCreatedCard(result, this.locale);
    await this.client.sendInteractiveCard(chatId, card);
  }

  async sendRawCard(chatId: string, card: Record<string, unknown>): Promise<void> {
    await this.client.sendInteractiveCard(chatId, card);
  }

  async sendMergeOperation(chatId: string, op: IMThreadMergeOperation): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    if (op.action === "preview") {
      const diffStats = {
        additions: op.diffStats?.additions ?? 0,
        deletions: op.diffStats?.deletions ?? 0,
        filesChanged: op.diffStats?.filesChanged ?? [],
        fileDiffs: op.diffStats?.fileDiffs
      };
      const card = buildMergePreviewCard(chatId, op.branchName, op.baseBranch, diffStats, true, undefined, undefined, undefined, this.locale);
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "conflict") {
      const diffStats = {
        additions: op.diffStats?.additions ?? 0,
        deletions: op.diffStats?.deletions ?? 0,
        filesChanged: op.diffStats?.filesChanged ?? [],
        fileDiffs: op.diffStats?.fileDiffs
      };
      const card = buildMergePreviewCard(chatId, op.branchName, op.baseBranch, diffStats, false, op.conflicts, op.resolverThread, undefined, this.locale);
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "success") {
      const card = buildMergeResultCard(op.branchName, op.baseBranch, true, op.message, undefined, this.locale);
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "rejected") {
      await this.client.sendMessage({ chatId, text: s.mergeRejected(op.branchName) });
    }
  }

  async sendFileReview(chatId: string, review: import("../../../services/event/im-output").IMFileMergeReview): Promise<void> {
    const card = review.sessionState === "recovery_required"
      ? buildMergeRecoveryRequiredCard(review, this.locale)
      : buildFileReviewCard(review, this.locale);
    await this.client.sendInteractiveCard(chatId, card);
  }

  async sendMergeSummary(chatId: string, summary: import("../../../services/event/im-output").IMMergeSummary): Promise<void> {
    const card = buildMergeSummaryCard(summary, this.locale);
    await this.client.sendInteractiveCard(chatId, card);
  }

  async sendSkillOperation(chatId: string, op: IMSkillOperation): Promise<void> {
    const s = getFeishuOutputAdapterStrings(this.locale);
    if (op.action === "form" && op.skills) {
      const options = op.skills.map((s) => ({
        text: { tag: "plain_text" as const, content: s.installed ? `✅ ${s.name}` : s.name },
        value: s.name
      }));
      const hasInstallable = op.skills.some((s) => !s.installed);
      const bodyElements: Record<string, unknown>[] = [];

      if (op.skills.length === 0) {
        bodyElements.push({ tag: "markdown", content: s.skillFormEmpty });
      } else {
        const listText = op.skills
          .map((s) => `${s.installed ? "✅" : "📦"} **${s.name}** — ${s.description || getFeishuOutputAdapterStrings(this.locale).skillNoDescription}`)
          .join("\n");
        bodyElements.push({ tag: "markdown", content: listText });

        if (hasInstallable) {
          bodyElements.push({ tag: "hr" });
          bodyElements.push({
            tag: "column_set", flex_mode: "none", background_style: "default",
            columns: [
              {
                tag: "column", width: "weighted", weight: 3, vertical_align: "center",
                elements: [{
                  tag: "select_static",
                  placeholder: { tag: "plain_text", content: s.skillSelectPlaceholder },
                  options,
                  value: { key: "skill_name" }
                }]
              },
              {
                tag: "column", width: "weighted", weight: 1, vertical_align: "center",
                elements: [{
                  tag: "button", text: { tag: "plain_text", content: s.skillInstallButton },
                  type: "primary", width: "default",
                  behaviors: [{ type: "callback", value: { action: "install_skill" } }]
                }]
              }
            ]
          });
        }
      }

      const card = {
        schema: "2.0",
        config: { width_mode: "fill" },
        header: {
          title: { tag: "plain_text", content: s.skillCardTitle },
          subtitle: { tag: "plain_text", content: s.skillInstalledCount(op.skills.filter((s) => s.installed).length, op.skills.length) },
          template: "indigo"
        },
        body: { direction: "vertical", vertical_spacing: "8px", padding: "4px 12px 12px 12px", elements: bodyElements }
      };
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "installed" && op.skill) {
      const card = {
        schema: "2.0",
        config: { width_mode: "fill" },
        header: {
          title: { tag: "plain_text", content: s.skillInstallSuccess(op.skill.name) },
          template: "green"
        },
        body: {
          direction: "vertical", vertical_spacing: "8px", padding: "4px 12px 12px 12px",
          elements: [
            { tag: "markdown", content: `**${op.skill.name}**\n${op.skill.description || s.skillNoDescription}` },
          ]
        }
      };
      await this.client.sendInteractiveCard(chatId, card);
      return;
    }

    if (op.action === "removed" && op.skill) {
      await this.client.sendMessage({ chatId, text: s.skillRemoved(op.skill.name) });
      return;
    }

    if (op.action === "admin_placeholder") {
      await this.client.sendMessage({ chatId, text: s.skillAdminPlaceholder });
      return;
    }

    if (op.action === "error") {
      await this.client.sendMessage({ chatId, text: s.skillError(op.error ?? s.unknownError) });
    }
  }

  // ── Admin panels ───────────────────────────────────────────────────────

  async sendAdminHelp(chatId: string): Promise<void> {
    await this.client.sendInteractiveCard(chatId, buildAdminHelpCard(this.locale));
  }

  async sendAdminProjectPanel(chatId: string, data: IMAdminProjectPanel): Promise<void> {
    await this.client.sendInteractiveCard(chatId, buildAdminProjectCard(data, undefined, this.locale));
  }

  async sendAdminMemberPanel(chatId: string, data: IMAdminMemberPanel): Promise<void> {
    await this.client.sendInteractiveCard(chatId, buildAdminMemberCard(data, undefined, this.locale));
  }

  async sendAdminSkillPanel(chatId: string, data: IMAdminSkillPanel): Promise<void> {
    await this.client.sendInteractiveCard(chatId, buildAdminSkillCard(data, this.locale));
  }

  async sendAdminBackendPanel(chatId: string, data: IMAdminBackendPanel): Promise<void> {
    await this.client.sendInteractiveCard(chatId, buildAdminBackendCard(data, this.locale));
  }

  // ── Card builder proxies (for card-handler callback returns) ───────────

  buildHelpCard(
    ownerId: string,
    opts?: Parameters<typeof buildHelpCard>[1]
  ) { return buildHelpCard(ownerId, { ...opts, locale: this.locale }); }
  buildHelpProjectCard(
    data: Parameters<typeof buildHelpProjectCard>[0],
    ownerId: string
  ) { return buildHelpProjectCard(data, ownerId, this.locale); }
  buildThreadListCard(
    threads: Array<{
      threadName: string;
      threadId?: string;
      active?: boolean;
      status?: "creating" | "active";
      backendName?: string;
      modelName?: string;
    }>,
    userId?: string,
    displayName?: string,
    isOnMain?: boolean
  ) { return buildThreadListCard(threads, userId, displayName, isOnMain, this.locale); }
  buildMergePreviewCard(
    chatId: string,
    branchName: string,
    baseBranch: string,
    diffStats: Parameters<typeof buildMergePreviewCard>[3],
    canMerge: boolean,
    conflicts?: string[],
    resolverThread?: { threadName: string; threadId: string },
    ownerId?: string,
  ) { return buildMergePreviewCard(chatId, branchName, baseBranch, diffStats, canMerge, conflicts, resolverThread, ownerId, this.locale); }
  buildMergeResultCard(
    branchName: string,
    baseBranch: string,
    success: boolean,
    message: string,
    diffStats?: Parameters<typeof buildMergeResultCard>[4],
    threadAction?: Parameters<typeof buildMergeResultCard>[6],
  ) { return buildMergeResultCard(branchName, baseBranch, success, message, diffStats, this.locale, threadAction); }
  buildSnapshotHistoryCard(
    snapshots: Array<{ turnId: string; turnIndex: number; agentSummary?: string; filesChanged?: string[]; createdAt: string; isCurrent: boolean }>,
    threadId: string,
    userId?: string,
    displayName?: string,
    threadName?: string,
    fromHelp?: boolean
  ) { return buildSnapshotHistoryCard(snapshots, threadId, userId, displayName, threadName, fromHelp, this.locale); }
  buildThreadCreatedCard(info: Parameters<typeof buildThreadCreatedCard>[0]) { return buildThreadCreatedCard(info, this.locale); }
  buildThreadNewCard(
    catalog: Parameters<typeof buildThreadNewCard>[0],
  ) { return buildThreadNewCard(catalog, this.locale); }
  buildInitCard(unboundProjects?: Array<{ id: string; name: string; cwd: string; gitUrl?: string }>) {
    return buildInitCard(unboundProjects, this.locale);
  }
  buildInitBindMenuCard(unboundProjects?: Array<{ id: string; name: string; cwd: string; gitUrl?: string }>) {
    return buildInitBindMenuCard(unboundProjects, this.locale);
  }
  buildInitCreateMenuCard(draft?: Parameters<typeof buildInitCreateMenuCard>[0]) { return buildInitCreateMenuCard(draft, this.locale); }
  buildInitProjectFileEditorCard(fileKey: "agents_md" | "gitignore", content: string) {
    return buildInitProjectFileEditorCard(fileKey, content, this.locale);
  }
  buildInitPendingCard(info: Parameters<typeof buildInitPendingCard>[0]) { return buildInitPendingCard(info, this.locale); }
  buildInitFailedCard(info: Parameters<typeof buildInitFailedCard>[0]) { return buildInitFailedCard(info, this.locale); }
  buildInitSuccessCard(info: Parameters<typeof buildInitSuccessCard>[0]) { return buildInitSuccessCard(info, this.locale); }
  buildModelListCard(currentModel: string, availableModels: string[], threadName?: string, userId?: string) {
    return buildModelListCard(currentModel, availableModels, threadName, userId, this.locale);
  }
  buildAdminHelpCard() { return buildAdminHelpCard(this.locale); }
  buildAdminProjectCard(data: Parameters<typeof buildAdminProjectCard>[0], searchKeyword?: string) {
    return buildAdminProjectCard(data, searchKeyword, this.locale);
  }
  buildAdminProjectEditCard(project: Parameters<typeof buildAdminProjectEditCard>[0]) { return buildAdminProjectEditCard(project, this.locale); }
  buildProjectResumedCard(project: Parameters<typeof buildProjectResumedCard>[0]) { return buildProjectResumedCard(project, this.locale); }
  buildAdminUserCard(data: Parameters<typeof buildAdminUserCard>[0], searchKeyword?: string) {
    return buildAdminUserCard(data, searchKeyword, this.locale);
  }
  buildAdminMemberCard(data: Parameters<typeof buildAdminMemberCard>[0], searchKeyword?: string) {
    return buildAdminMemberCard(data, searchKeyword, this.locale);
  }
  buildAdminSkillCard(data: Parameters<typeof buildAdminSkillCard>[0]) { return buildAdminSkillCard(data, this.locale); }
  buildAdminSkillInstallCard() { return buildAdminSkillInstallCard(this.locale); }
  buildAdminSkillFileInstallCard(options?: Parameters<typeof buildAdminSkillFileInstallCard>[0]) {
    return buildAdminSkillFileInstallCard(options, this.locale);
  }
  buildAdminSkillFileConfirmCard(data: Parameters<typeof buildAdminSkillFileConfirmCard>[0]) {
    return buildAdminSkillFileConfirmCard(data, this.locale);
  }
  buildAdminBackendCard(data: Parameters<typeof buildAdminBackendCard>[0]) { return buildAdminBackendCard(data, this.locale); }
  buildAdminBackendEditCard(data: Parameters<typeof buildAdminBackendEditCard>[0], backendName: string) {
    return buildAdminBackendEditCard(data, backendName, this.locale);
  }
  buildAdminBackendModelCard(data: Parameters<typeof buildAdminBackendModelCard>[0], backendName: string) {
    return buildAdminBackendModelCard(data, backendName, this.locale);
  }
  buildAdminBackendPolicyCard(data: Parameters<typeof buildAdminBackendPolicyCard>[0], backendName: string) {
    return buildAdminBackendPolicyCard(data, backendName, this.locale);
  }
  buildAdminBackendAddProviderCard(data: Parameters<typeof buildAdminBackendAddProviderCard>[0], backendName: string) {
    return buildAdminBackendAddProviderCard(data, backendName, this.locale);
  }
  buildHelpThreadCard(
    threads: Array<{
      threadName: string;
      threadId?: string;
      active?: boolean;
      status?: "creating" | "active";
      backendName?: string;
      modelName?: string;
    }>,
    userId: string,
    displayName?: string,
    isOnMain?: boolean
  ) { return buildHelpThreadCard(threads, userId, displayName, isOnMain, this.locale); }
  buildHelpThreadNewCard(
    userId: string,
    catalog: Parameters<typeof buildHelpThreadNewCard>[1],
  ) { return buildHelpThreadNewCard(userId, catalog, this.locale); }
  buildHelpMergeCard(ownerId: string, branchName?: string) { return buildHelpMergeCard(ownerId, branchName, this.locale); }
  buildHelpSkillCard(skills: Parameters<typeof buildHelpSkillCard>[0], ownerId: string) { return buildHelpSkillCard(skills, ownerId, this.locale); }
  buildHelpBackendCard(backends: Parameters<typeof buildHelpBackendCard>[0], ownerId: string) { return buildHelpBackendCard(backends, ownerId, this.locale); }
  buildTurnHistoryCard(turns: Parameters<typeof buildTurnHistoryCard>[0], ownerId?: string, fromHelp?: boolean) {
    return buildTurnHistoryCard(turns, ownerId, fromHelp, this.locale);
  }
  buildFileReviewCard(review: Parameters<typeof buildFileReviewCard>[0]) { return buildFileReviewCard(review, this.locale); }
  buildMergeRecoveryRequiredCard(review: Parameters<typeof buildMergeRecoveryRequiredCard>[0]) { return buildMergeRecoveryRequiredCard(review, this.locale); }
  buildMergeFileDetailCard(review: Parameters<typeof buildMergeFileDetailCard>[0]) { return buildMergeFileDetailCard(review, this.locale); }
  buildMergeAgentAssistCard(
    review: Parameters<typeof buildMergeAgentAssistCard>[0],
    backends: Parameters<typeof buildMergeAgentAssistCard>[1]
  ) { return buildMergeAgentAssistCard(review, backends, this.locale); }
  buildMergeSummaryCard(summary: Parameters<typeof buildMergeSummaryCard>[0]) { return buildMergeSummaryCard(summary, this.locale); }
}
