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
 * - `handleCardAction` — deprecated alias for backward compatibility
 */
import type { CardActionResponse } from "../handlers/types";
import type { FeishuHandlerDeps } from "./types";
import { armPendingFeishuSkillInstall, clearFeishuSkillInstallState, consumeStagedFeishuSkillInstall, peekStagedFeishuSkillInstall } from "./skill-file-install-state";
import {
  sendProjectList, sendSnapshotList, sendModelList, sendThreadNewForm,
  resolveHelpCard, resolveHelpThreadCard, resolveHelpThreadNewCard, resolveHelpMergeCard,
  resolveSnapshotCard, resolveHelpSkillCard, resolveHelpBackendCard, resolveHelpTurnCard
} from "./shared-handlers";
import { routeIntent } from "../../packages/channel-core/src/intent-router";
import type { IntentType } from "../../packages/channel-core/src/types";
import { MAIN_THREAD_NAME } from "../../packages/agent-core/src/constants";
import { isBackendId, transportFor } from "../../packages/agent-core/src/backend-identity";
import { createLogger } from "../../packages/channel-core/src/index";
import { authorizeIntent } from "../../services/iam/src/command-guard";
import { AuthorizationError } from "../../services/iam/src/authorize";
import { ErrorCode, OrchestratorError } from "../../services/orchestrator/src/errors";
import { execFile as execFileCb } from "node:child_process";
import { join as pathJoin } from "node:path";
import { promisify } from "node:util";
import { getFeishuNotifyCatalog, notify } from "./feishu-notify";
import { getFeishuCardHandlerStrings } from "./feishu-card-handler.strings";
import { rm } from "node:fs/promises";

const execFileAsync = promisify(execFileCb);

const log = createLogger("action");
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

async function resolveUnifiedTurnCard(deps: FeishuHandlerDeps, chatId: string, operatorId: string, turnId: string): Promise<Record<string, unknown> | undefined> {
  try {
    const recovery = await deps.orchestrator.getTurnDetail(chatId, turnId);
    return deps.feishuOutputAdapter.primeHistoricalTurnCard({
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

function greyTip(content: string): Record<string, unknown> {
  return {
    tag: "div",
    text: { tag: "plain_text", content, text_size: "notation", text_color: "grey" }
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
  return rawCard(deps.feishuOutputAdapter.buildFileReviewCard(review));
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
    const successCard = deps.feishuOutputAdapter.buildInitSuccessCard({
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
        return notify(
          deps,
          chatId,
          s.threadCreated(threadName, backendId, model, created.threadId.slice(0, 12))
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ threadName, backend: backendId, transport: transportFor(backendId), err: msg }, "create_thread async failed");
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
      return rawCard(deps.feishuOutputAdapter.buildThreadListCard(
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
    return rawCard(deps.feishuOutputAdapter.buildThreadListCard(
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
      return rawCard(deps.feishuOutputAdapter.buildMergeResultCard(branchName, baseBranch, mergeResult.success, mergeResult.message));
    } catch (error) {
      return rawCard(deps.feishuOutputAdapter.buildMergeResultCard(
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
    return rawCard(deps.feishuOutputAdapter.buildSnapshotHistoryCard(
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
    await deps.feishuOutputAdapter.sendSkillOperation(chatId, {
      kind: "skill_operation",
      action: "installed",
      skill: { name: def.name, description: def.description, installed: true }
    });
  } catch (error) {
    await deps.feishuOutputAdapter.sendSkillOperation(chatId, {
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

function buildAdminProjectData(deps: FeishuHandlerDeps): import("../../packages/channel-core/src/im-output").IMAdminProjectPanel {
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

async function buildAdminMemberData(deps: FeishuHandlerDeps): Promise<import("../../packages/channel-core/src/im-output").IMAdminMemberPanel> {
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

async function buildAdminUserData(deps: FeishuHandlerDeps, page = 0): Promise<import("../../packages/channel-core/src/im-output").IMAdminUserPanel> {
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
): Promise<import("../../packages/channel-core/src/im-output").IMAdminSkillPanel> {
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

async function buildAdminBackendData(deps: FeishuHandlerDeps): Promise<import("../../packages/channel-core/src/im-output").IMAdminBackendPanel> {
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
    return rawCard(deps.feishuOutputAdapter.buildAdminSkillInstallCard
      ? deps.feishuOutputAdapter.buildAdminSkillInstallCard()
      : deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
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
      const card = deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId));
      if (messageId) {
        await deps.feishuAdapter.updateInteractiveCard(messageId, card);
      } else {
        await deps.feishuOutputAdapter.sendRawCard(chatId, card);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateInstallTask(chatId, taskId, { status: "failed", detail: msg });
      log.error({ chatId, operatorId, taskId, installMode, source, pluginName, err: msg }, "admin_skill_install_failed");
      const card = deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId));
      if (messageId) {
        await deps.feishuAdapter.updateInteractiveCard(messageId, card);
      } else {
        await deps.feishuOutputAdapter.sendRawCard(chatId, card);
      }
    }
  })();

  return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
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
    deps.feishuOutputAdapter.buildAdminSkillFileInstallCard
      ? deps.feishuOutputAdapter.buildAdminSkillFileInstallCard({ mode: "awaiting_upload" })
      : deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId))
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
    return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
  }
  try {
    if (!deps.pluginService.installFromLocalSource) throw new Error(s.localSkillImportUnavailable);
    if (!deps.pluginService.validateSkillNameCandidate) throw new Error(s.skillNameValidationUnavailable);
    const formValues = payload.action?.form_value ?? {};
    const finalPluginName = String(formValues.skill_name ?? "").trim() || staged.pluginName;
    const validation = deps.pluginService.validateSkillNameCandidate(finalPluginName);
    if (!validation.ok || !validation.normalizedName) {
      return rawCard(
        deps.feishuOutputAdapter.buildAdminSkillFileConfirmCard
          ? deps.feishuOutputAdapter.buildAdminSkillFileConfirmCard({
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
          : deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId))
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
  return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
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
  return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, chatId)));
}

async function handleAdminBackendValidateModel(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const backend = String(actionValue.backend ?? "");
  const provider = String(actionValue.provider ?? "");
  const formValues = payload.action?.form_value ?? {};
  const rawInput = String(Object.entries(formValues).find(([k]) => k.startsWith("mn_"))?.[1] ?? "").trim();
  if (!backend || !provider || !rawInput) return;

  // Parse input: JSON config or plain model name
  // Supports: {"glm-5":{...}} | "glm-5":{...} | glm-5
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
    modelName = rawInput; // Plain model name
  }

  log.info({ backendId: backend, providerName: provider, modelName, hasConfig: !!modelConfig, chatId, traceId: payload.context?.open_message_id }, "admin_backend_add_model");

  // Add model via orchestrator facade (fire-and-forget validate inside)
  await deps.orchestrator.adminAddModel(backend, provider, modelName, modelConfig, {
    chatId,
    traceId: payload.context?.open_message_id,
    userId: String(payload.operator?.open_id ?? "")
  });

  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendModelCard(data, backend));
}

async function handleAdminBackendRecheck(
  deps: FeishuHandlerDeps,
  chatId: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const backend = String(actionValue.backend ?? "");
  const provider = String(actionValue.provider ?? "");
  if (!backend || !provider) return;

  log.info({ backendId: backend, providerName: provider, chatId }, "admin_backend_recheck");

  // Trigger recheck via orchestrator (fire-and-forget)
  await deps.orchestrator.adminTriggerRecheck(backend, provider, { chatId });

  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendModelCard(data, backend));
}

async function handleAdminBackendAddProvider(
  deps: FeishuHandlerDeps,
  payload: CardActionData,
  chatId: string,
  actionValue: Record<string, unknown>
): Promise<CardActionResponse> {
  const backend = String(actionValue.backend ?? "");
  const formValues = payload.action?.form_value ?? {};
  // form input names: "pn", "pu", "pk" (edit card uses simple names)
  const providerName = String(Object.entries(formValues).find(([k]) => k.startsWith("pn"))?.[1] ?? "").trim();
  const baseUrl = String(Object.entries(formValues).find(([k]) => k.startsWith("pu"))?.[1] ?? "").trim() || undefined;
  const apiKeyEnv = String(Object.entries(formValues).find(([k]) => k.startsWith("pk"))?.[1] ?? "").trim() || undefined;
  if (!backend || !providerName) return;

  log.info({ backendId: backend, providerName, baseUrl, apiKeyEnv, chatId, traceId: payload.context?.open_message_id }, "admin_backend_add_source");
  await deps.orchestrator.adminAddProvider(backend, providerName, baseUrl, apiKeyEnv, {
    chatId,
    traceId: payload.context?.open_message_id,
    userId: String(payload.operator?.open_id ?? "")
  });

  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendEditCard(data, backend));
}

// ── Card Action Registry ───────────────────────────────────────────────────────
//
// 注册模式：每个 handler 在注册时声明 action 名 + IntentType（权限标记）。
// 入口函数统一 lookup → authorize → dispatch，无 if-else 链。
//
// IntentType → Permission 映射由 services/iam/src/command-guard.ts 控制（共享层），
// 此处不含任何权限规则——仅声明"此 action 对应哪个 intent"。
// ────────────────────────────────────────────────────────────────────────────────

/** 所有 handler 接收的统一上下文 */
interface CardActionContext {
  payload: CardActionData;
  action: string;
  actionValue: Record<string, unknown>;
  operatorId: string;
  chatId: string;
  messageId: string;
}

type CardActionHandlerFn = (deps: FeishuHandlerDeps, ctx: CardActionContext) => Promise<CardActionResponse>;

interface CardActionRegistration {
  /** IntentType for authorization. null = handler does internal auth (e.g. exec_command). */
  intent: IntentType | null;
  handler: CardActionHandlerFn;
}

const actionRegistry = new Map<string, CardActionRegistration>();

function register(action: string | string[], intent: IntentType | null, handler: CardActionHandlerFn): void {
  const actions = Array.isArray(action) ? action : [action];
  for (const a of actions) {
    actionRegistry.set(a, { intent, handler });
  }
}

// ── Handler Registrations ──────────────────────────────────────────────────────

register("init_project", "PROJECT_CREATE", (deps, ctx) =>
  handleInitProjectAction(deps, ctx.payload, ctx.chatId, ctx.operatorId, ctx.actionValue));

register("init_root_menu", "PROJECT_CREATE", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildInitCard(getUnboundProjects(deps))));

register("init_bind_menu", "PROJECT_CREATE", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildInitBindMenuCard(getUnboundProjects(deps))));

register("init_create_menu", "PROJECT_CREATE", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildInitCreateMenuCard()));

register("create_thread", "THREAD_NEW", (deps, ctx) =>
  handleCreateThreadAction(deps, ctx.payload, ctx.chatId, ctx.operatorId, ctx.actionValue));

register(["approve", "deny", "approve_always"], "TURN_START", async (deps, ctx) => {
  return handleApprovalAction(deps, ctx.chatId, ctx.operatorId, ctx.action, ctx.actionValue);
});

register("user_input_submit", "TURN_START", async (deps, ctx) => {
  const callId = String(ctx.actionValue.callId ?? "");
  const metaStr = String(ctx.actionValue.questionMeta ?? "[]");
  const threadNameFromCard = String(ctx.actionValue.threadName ?? "").trim();
  const turnId = String(ctx.actionValue.turnId ?? "").trim();
  if (!callId) return;

  let questionMeta: Array<{ idx: number; id: string; defaultAnswer: string }>;
  try { questionMeta = JSON.parse(metaStr); } catch { questionMeta = []; }

  const formValues = ctx.payload.action?.form_value ?? {};

  // Build answers: { questionId: [selectedValue] }
  const answers: Record<string, string[]> = {};
  for (const q of questionMeta) {
    const formKey = `q_${q.idx}`;
    const selected = formValues[formKey] ?? q.defaultAnswer;
    answers[q.id] = [String(selected)];
  }

  // Resolve user's active thread
  const binding = await deps.orchestrator.getUserActiveThread(ctx.chatId, ctx.operatorId);
  const threadName = threadNameFromCard || binding?.threadName || "__main__";

  try {
    await deps.orchestrator.respondUserInput(ctx.chatId, threadName, callId, answers);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    await notify(deps, ctx.chatId, s.submitUserInputFailed(msg));
    return;
  }

  // Replace card with confirmation
  const summary = questionMeta.map(q => {
    const val = answers[q.id]?.[0] ?? "";
    return `• ${q.id}: **${val}**`;
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
        { tag: "markdown", content: s.planSelectionSubmitted(ctx.operatorId, timeStr) },
        { tag: "markdown", content: summary }
      ]
    }
  });
});

// ── Help card sub-panel actions ──

register("help_home", "HELP", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_threads", "THREAD_LIST", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpThreadCard(deps, ctx.chatId, ctx.operatorId));
});

register(["help_switch_thread", "help_switch_to_main"], "THREAD_SWITCH", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  try {
    if (ctx.action === "help_switch_thread") {
      const threadName = String(ctx.actionValue.threadName ?? "");
      if (!threadName) return;
      await deps.orchestrator.handleThreadJoin(ctx.chatId, ctx.operatorId, threadName);
    } else {
      await deps.orchestrator.handleThreadLeave(ctx.chatId, ctx.operatorId);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await notify(deps, ctx.chatId, ERR.switchFailed(msg));
    return;
  }
  return rawCard(await resolveHelpThreadCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_thread_new", "THREAD_NEW", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpThreadNewCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_create_thread", "THREAD_NEW", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  const creatingCard = await handleCreateThreadAction(deps, ctx.payload, ctx.chatId, ctx.operatorId, ctx.actionValue);
  if (creatingCard) {
    return rawCard(await resolveHelpThreadCard(deps, ctx.chatId, ctx.operatorId));
  }
  return;
});

register("help_merge", "THREAD_MERGE", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpMergeCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_merge_preview", "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  const branchName = String(ctx.actionValue.branchName ?? "");
  if (!branchName) return;
  try {
    const preview = await deps.orchestrator.handleMergePreview(ctx.chatId, branchName, mergeActionContext(ctx));
    if (!preview.canMerge) {
      return await startMergeReviewFlow(deps, ctx, branchName);
    }
    const diffStats = preview.diffStats ?? { additions: 0, deletions: 0, filesChanged: [] };
    const baseBranch = typeof (preview as { baseBranch?: unknown }).baseBranch === "string"
      ? (preview as { baseBranch: string }).baseBranch
      : "main";
    return rawCard(deps.feishuOutputAdapter.buildMergePreviewCard(
      ctx.chatId,
      branchName,
      baseBranch,
      diffStats,
      preview.canMerge,
      preview.conflicts,
      undefined,
      ctx.operatorId
    ));
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.mergePreview(error instanceof Error ? error.message : String(error)));
    return;
  }
});

register("merge_start_review", "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const branchName = String(ctx.actionValue.branchName ?? "");
  if (!branchName) return;
  try {
    return await startMergeReviewFlow(deps, ctx, branchName);
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
  }
});

register("help_history", "SNAPSHOT_LIST", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveSnapshotCard(deps, ctx.chatId, ctx.operatorId, true));
});

register("help_skills", "SKILL_LIST", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpSkillCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_skill_install", "SKILL_INSTALL", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  const skillName = String(ctx.actionValue.skillName ?? "");
  if (!skillName) return;
  const project = deps.findProjectByChatId(ctx.chatId);
  try {
    await deps.pluginService.install(skillName, project?.id, ctx.operatorId);
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.skillInstall(error instanceof Error ? error.message : String(error)));
  }
  return rawCard(await resolveHelpSkillCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_skill_remove", "SKILL_REMOVE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  const name = String(ctx.actionValue.name ?? "");
  if (!name) return;
  const project = deps.findProjectByChatId(ctx.chatId);
  try {
    if (project?.id) {
      await deps.pluginService.unbindFromProject?.(project.id, name);
    } else {
      await deps.pluginService.remove(name);
    }
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.skillRemove(error instanceof Error ? error.message : String(error)));
  }
  return rawCard(await resolveHelpSkillCard(deps, ctx.chatId, ctx.operatorId));
});

register("help_backends", "HELP", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpBackendCard(deps, ctx.operatorId));
});

// ── Turn Card sub-page actions ──

register("help_turns", "HELP", async (deps, ctx) => {
  if (!checkHelpCardOwner(ctx.actionValue, ctx.operatorId)) return;
  return rawCard(await resolveHelpTurnCard(deps, ctx.chatId, ctx.operatorId));
});

register("view_file_changes", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const page = Number(ctx.actionValue.page ?? 0);
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnSubpage(
    deps,
    targetChatId,
    ctx.operatorId,
    turnId,
    () => deps.feishuOutputAdapter.renderFileChangesCard(targetChatId, turnId, page)
  );
  return card ? rawCard(card) : undefined;
});

register("file_changes_page", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const page = Number(ctx.actionValue.page ?? 0);
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnSubpage(
    deps,
    targetChatId,
    ctx.operatorId,
    turnId,
    () => deps.feishuOutputAdapter.renderFileChangesCard(targetChatId, turnId, page)
  );
  return card ? rawCard(card) : undefined;
});

register("file_changes_back", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnCard(deps, targetChatId, ctx.operatorId, turnId);
  return card ? rawCard(card) : undefined;
});

register("view_tool_progress", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const page = Number(ctx.actionValue.page ?? 0);
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnSubpage(
    deps,
    targetChatId,
    ctx.operatorId,
    turnId,
    () => deps.feishuOutputAdapter.renderToolProgressCard(targetChatId, turnId, page)
  );
  return card ? rawCard(card) : undefined;
});

register("tool_progress_page", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const page = Number(ctx.actionValue.page ?? 0);
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnSubpage(
    deps,
    targetChatId,
    ctx.operatorId,
    turnId,
    () => deps.feishuOutputAdapter.renderToolProgressCard(targetChatId, turnId, page)
  );
  return card ? rawCard(card) : undefined;
});

register("tool_progress_back", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnCard(deps, targetChatId, ctx.operatorId, turnId);
  return card ? rawCard(card) : undefined;
});

register("view_turn_detail", "HELP", async (deps, ctx) => {
  const turnId = String(ctx.actionValue.turnId ?? "");
  const targetChatId = resolveTurnChatId(ctx.actionValue, ctx.chatId);
  const card = await resolveUnifiedTurnCard(deps, targetChatId, ctx.operatorId, turnId);
  return card ? rawCard(card) : undefined;
});

register("interrupt", "TURN_INTERRUPT", async (deps, ctx) => {
  const turnId = typeof ctx.actionValue.turnId === "string" ? ctx.actionValue.turnId : "";
  await deps.orchestrator.handleTurnInterrupt(ctx.chatId, ctx.operatorId || undefined);
  const card = await deps.feishuOutputAdapter.updateCardAction(ctx.chatId, turnId, "interrupted");
  return card ? rawCard(card) : undefined;
});

register("accept_changes", "TURN_START", async (deps, ctx) => {
  const turnId = typeof ctx.actionValue.turnId === "string" ? ctx.actionValue.turnId : "";
  if (!turnId) return;
  await deps.orchestrator.acceptTurn(ctx.chatId, turnId);
  const card = await deps.feishuOutputAdapter.updateCardAction(ctx.chatId, turnId, "accepted");
  return card ? rawCard(card) : undefined;
});

register("revert_changes", "TURN_START", async (deps, ctx) => {
  const turnId = typeof ctx.actionValue.turnId === "string" ? ctx.actionValue.turnId : "";
  if (!turnId) return;
  await deps.orchestrator.revertTurn(ctx.chatId, turnId);
  const card = await deps.feishuOutputAdapter.updateCardAction(ctx.chatId, turnId, "reverted");
  return card ? rawCard(card) : undefined;
});

register(["switch_thread", "switch_to_main"], "THREAD_SWITCH", (deps, ctx) =>
  handleThreadSwitchAction(deps, ctx.chatId, ctx.operatorId, ctx.action, ctx.actionValue));

register(["confirm_merge", "cancel_merge"], "THREAD_MERGE", (deps, ctx) =>
  handleMergeAction(deps, ctx.chatId, ctx.action, ctx.actionValue, mergeActionContext(ctx)));

// ── Per-file merge review actions ──

register(["merge_accept", "merge_keep_main", "merge_use_branch", "merge_skip"], "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const branchName = String(ctx.actionValue.branchName ?? "");
  const filePath = String(ctx.actionValue.filePath ?? "");
  if (!branchName || !filePath) return;

  // Map action name → decision value
  const decisionMap: Record<string, "accept" | "keep_main" | "use_branch" | "skip"> = {
    merge_accept: "accept",
    merge_keep_main: "keep_main",
    merge_use_branch: "use_branch",
    merge_skip: "skip",
  };
  const decision = decisionMap[ctx.action];
  if (!decision) return;

  try {
    const result = await deps.orchestrator.mergeDecideFile(ctx.chatId, branchName, filePath, decision, mergeActionContext(ctx));
    if (result.kind === "file_merge_review") {
      return rawCard(deps.feishuOutputAdapter.buildFileReviewCard(result));
    }
    // Summary: all files decided
    return rawCard(deps.feishuOutputAdapter.buildMergeSummaryCard(result));
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
  }
});

// Phase 2: reject with prompt → Agent retry
register("merge_reject", "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const branchName = String(ctx.actionValue.branchName ?? "");
  const filePath = String(ctx.actionValue.filePath ?? "");
  if (!branchName || !filePath) return;

  // Read feedback from the card's input field
  const formValues = (ctx.payload.action as Record<string, unknown>)?.form_value as Record<string, string> | undefined;
  const feedback = formValues?.merge_feedback?.trim() || "";

  try {
    const review = await deps.orchestrator.retryMergeFile(ctx.chatId, branchName, filePath, feedback, mergeActionContext(ctx));
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    await notify(deps, ctx.chatId, s.mergeRetrying(filePath));
    return rawCard(deps.feishuOutputAdapter.buildFileReviewCard(review));
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
  }
});

register("merge_accept_all", "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const branchName = String(ctx.actionValue.branchName ?? "");
  if (!branchName) return;
  try {
    const summary = await deps.orchestrator.mergeAcceptAll(ctx.chatId, branchName, mergeActionContext(ctx));
    if (summary.kind === "file_merge_review") {
      return rawCard(deps.feishuOutputAdapter.buildFileReviewCard(summary));
    }
    return rawCard(deps.feishuOutputAdapter.buildMergeSummaryCard(summary));
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
  }
});

register("merge_commit", "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const branchName = String(ctx.actionValue.branchName ?? "");
  const baseBranch = String(ctx.actionValue.baseBranch ?? "main");
  if (!branchName) return;
  try {
    const result = await deps.orchestrator.commitMergeReview(ctx.chatId, branchName, mergeActionContext(ctx));
    return rawCard(deps.feishuOutputAdapter.buildMergeResultCard(branchName, baseBranch, result.success, result.message));
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
  }
});

register("merge_cancel", "THREAD_MERGE", async (deps, ctx) => {
  const { ERR } = getFeishuNotifyCatalog(deps.config.locale);
  const branchName = String(ctx.actionValue.branchName ?? "");
  const baseBranch = String(ctx.actionValue.baseBranch ?? "main");
  if (!branchName) return;
  try {
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    await deps.orchestrator.cancelMergeReview(ctx.chatId, branchName, mergeActionContext(ctx));
    return rawCard({
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
        elements: [
          { tag: "markdown", content: s.mergeReviewCanceledBody(branchName, baseBranch) },
          { tag: "hr" },
          {
            tag: "interactive_container",
            width: "fill",
            height: "auto",
            has_border: true,
            border_color: "grey",
            corner_radius: "8px",
            padding: "10px 12px 10px 12px",
            behaviors: [{ type: "callback", value: { action: "help_merge", ownerId: ctx.operatorId, branchName } }],
            elements: [{
              tag: "markdown",
              content: s.backToMergePanel,
              icon: { tag: "standard_icon", token: "arrow-left_outlined", color: "grey" }
            }]
          }
        ]
      }
    });
  } catch (error) {
    await notify(deps, ctx.chatId, ERR.generic(error instanceof Error ? error.message : String(error)));
  }
});

register("jump_snapshot", "SNAPSHOT_LIST", (deps, ctx) =>
  handleSnapshotAction(deps, ctx.chatId, ctx.operatorId, ctx.actionValue));

register("install_skill", "SKILL_INSTALL", async (deps, ctx) => {
  await handleSkillAction(deps, ctx.payload, ctx.chatId, ctx.actionValue);
  // A2: Refresh skill list card after install
  return rawCard(await resolveHelpSkillCard(deps, ctx.chatId, ctx.operatorId));
});

// ── Admin panel ──

register("admin_panel_home", "ADMIN_HELP", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildAdminHelpCard()));

register("admin_panel_project", "ADMIN_HELP", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildAdminProjectCard(buildAdminProjectData(deps))));

// ── Project management actions (admin-only) ──

register("admin_project_edit", "ADMIN_HELP", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  if (!projectId) return;
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const state = deps.adminStateStore.read();
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const card = deps.feishuOutputAdapter.buildAdminProjectEditCard({
    id: project.id,
    name: project.name,
    gitUrl: project.gitUrl,
    chatId: project.chatId
  });
  return rawCard(alignButtonStyle(card, s.alignBackProjectManagement, s.alignSave));
});

register("admin_project_save", "ADMIN_HELP", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  if (!projectId) return;
  const s = getFeishuCardHandlerStrings(deps.config.locale);
  const formValues = (ctx.payload.action as Record<string, unknown>)?.form_value as Record<string, string> | undefined;
  const newName = formValues?.project_name?.trim();
  const newGitUrl = formValues?.git_url?.trim();
  const state = deps.adminStateStore.read();
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  if (newName && newName !== project.name) {
    if (state.projects.some(p => p.name === newName && p.id !== projectId)) {
      const card = deps.feishuOutputAdapter.buildAdminProjectEditCard({
        id: project.id, name: project.name, gitUrl: project.gitUrl
      });
      return rawCard(alignButtonStyle(card, s.alignBackProjectManagement, s.alignSave));
    }
    project.name = newName;
  }
  if (newGitUrl !== undefined) {
    project.gitUrl = newGitUrl || undefined;
    // Update git remote if project has a cwd
    if (newGitUrl && project.cwd) {
      try {
        await deps.projectSetupService.updateGitRemote(project.cwd, newGitUrl);
      } catch (err) {
        log.warn({ projectId, err }, "admin_project_save: updateGitRemote failed");
      }
    }
  }
  project.updatedAt = new Date().toISOString();
  deps.adminStateStore.write(state);
  log.info({ projectId, newName, newGitUrl }, "admin_project_save");
  return rawCard(deps.feishuOutputAdapter.buildAdminProjectCard(buildAdminProjectData(deps)));
});

register("admin_project_toggle", "ADMIN_HELP", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  if (!projectId) return;
  const state = deps.adminStateStore.read();
  const project = state.projects.find(p => p.id === projectId);
  if (!project) return;
  const wasActive = project.status === "active";
  project.status = wasActive ? "disabled" : "active";
  project.updatedAt = new Date().toISOString();
  deps.adminStateStore.write(state);
  // Release subprocesses when disabling
  if (wasActive && project.chatId) {
    await deps.orchestrator.onProjectDeactivated(project.chatId);
  }
  // Recover sessions when re-enabling before accepting further turns for this project
  if (!wasActive && project.chatId) {
    const { recovered, failed, failures } = await deps.orchestrator.recoverSessions([project.id]);
    if (failed > 0) {
      throw new Error(`session recovery after re-enable failed for ${failed} thread(s): ${failures.map(item => `${item.projectId}/${item.threadName}[${item.category}]: ${item.reason}`).join("; ")}`);
    }
    log.info({ projectId, recovered, failed }, "session recovery after re-enable done");
  }
  log.info({ projectId, newStatus: project.status }, "admin_project_toggle");
  return rawCard(deps.feishuOutputAdapter.buildAdminProjectCard(buildAdminProjectData(deps)));
});

register("admin_project_unbind", "ADMIN_HELP", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  if (!projectId) return;
  const result = await deps.projectSetupService.disableAndUnbindProjectById(projectId);
  if (!result) return;
  // Release subprocesses for old chat
  if (result.oldChatId) {
    await deps.orchestrator.onProjectDeactivated(result.oldChatId);
    try { await deps.feishuAdapter.leaveChat(result.oldChatId); } catch (error) {
      log.warn({ oldChatId: result.oldChatId, err: error instanceof Error ? error.message : String(error) }, "leaveChat after unbind failed");
    }
  }
  log.info({ projectId, oldChatId: result.oldChatId, newStatus: result.newStatus }, "admin_project_unbind");
  return rawCard(deps.feishuOutputAdapter.buildAdminProjectCard(buildAdminProjectData(deps)));
});

register("admin_project_delete", "ADMIN_HELP", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  if (!projectId) return;
  const state = deps.adminStateStore.read();
  const idx = state.projects.findIndex(p => p.id === projectId);
  if (idx < 0) return;
  const project = state.projects[idx]!;
  const oldChatId = project.chatId;
  state.projects.splice(idx, 1);
  delete state.members[projectId];
  deps.adminStateStore.write(state);
  // Release subprocesses for deleted project
  if (oldChatId) {
    await deps.orchestrator.onProjectDeactivated(oldChatId);
    try { await deps.feishuAdapter.leaveChat(oldChatId); } catch (error) {
      log.warn({ oldChatId, err: error instanceof Error ? error.message : String(error) }, "leaveChat after delete failed");
    }
  }
  log.info({ projectId, oldChatId }, "admin_project_delete");
  return rawCard(deps.feishuOutputAdapter.buildAdminProjectCard(buildAdminProjectData(deps)));
});

register("bind_existing_project", "PROJECT_CREATE", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  if (!projectId || !ctx.chatId) return;
  try {
    const result = await deps.projectSetupService.bindExistingProject(ctx.chatId, projectId, ctx.operatorId);
    void pushProjectHelpCard(deps, ctx.chatId, ctx.operatorId).catch((error) => {
      log.warn({ chatId: ctx.chatId, operatorId: ctx.operatorId, err: error instanceof Error ? error.message : String(error) }, "send bind project help card failed");
    });
    return rawCard(deps.feishuOutputAdapter.buildInitSuccessCard({
      projectName: result.projectName,
      id: result.projectId,
      cwd: result.cwd,
      gitUrl: result.gitUrl ?? "",
      operatorId: ctx.operatorId
    }));
  } catch (err) {
    log.warn({ projectId, chatId: ctx.chatId, err }, "bind_existing_project failed");
  }
});

register("admin_panel_member", "ADMIN_HELP", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildAdminMemberCard(await buildAdminMemberData(deps))));

register("admin_panel_user", "ADMIN_HELP", async (deps) =>
  rawCard(deps.feishuOutputAdapter.buildAdminUserCard(await buildAdminUserData(deps))));

register("admin_panel_skill", "ADMIN_HELP", async (deps, ctx) => {
  const data = await buildAdminSkillData(deps, ctx.chatId);
  return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(data));
});

register("admin_panel_backend", "ADMIN_HELP", async (deps) => {
  const data = await buildAdminBackendData(deps);
  const card = deps.feishuOutputAdapter.buildAdminBackendCard(data);
  log.info({ cardSize: JSON.stringify(card).length, elementCount: (card as any).body?.elements?.length }, "admin_panel_backend card built");
  return rawCard(card);
});

register("admin_backend_edit", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendEditCard(data, backend));
});

register("admin_backend_policy_edit", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendPolicyCard(data, backend));
});

register("admin_backend_add_provider_form", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendAddProviderCard(data, backend));
});

register("admin_skill_install_open", "ADMIN_HELP", async (deps, ctx) =>
  rawCard(deps.feishuOutputAdapter.buildAdminSkillInstallCard
    ? deps.feishuOutputAdapter.buildAdminSkillInstallCard()
    : deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, ctx.chatId))));

register("admin_skill_file_install_open", "ADMIN_HELP", async (deps, ctx) =>
  rawCard(deps.feishuOutputAdapter.buildAdminSkillFileInstallCard
    ? deps.feishuOutputAdapter.buildAdminSkillFileInstallCard()
    : deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, ctx.chatId))));

register("admin_skill_install_submit", "ADMIN_HELP", (deps, ctx) =>
  handleAdminSkillInstallSubmit(deps, ctx.payload, ctx.chatId, ctx.operatorId, ctx.actionValue, ctx.messageId));

register("admin_skill_file_install_submit", "ADMIN_HELP", (deps, ctx) =>
  handleAdminSkillFileInstallSubmit(deps, ctx.payload, ctx.chatId, ctx.operatorId));

register("admin_skill_file_install_confirm", "ADMIN_HELP", (deps, ctx) =>
  handleAdminSkillFileInstallConfirm(deps, ctx.payload, ctx.chatId, ctx.operatorId));

register("admin_skill_file_install_cancel", "ADMIN_HELP", (deps, ctx) =>
  handleAdminSkillFileInstallCancel(deps, ctx.chatId, ctx.operatorId));

register("admin_skill_bind", "ADMIN_HELP", async (deps, ctx) => {
  const pluginName = String(ctx.actionValue.pluginName ?? "");
  const project = deps.findProjectByChatId(ctx.chatId);
  if (!pluginName || !project?.id) {
    const s = getFeishuCardHandlerStrings(deps.config.locale);
    await notify(deps, ctx.chatId, s.enablePluginNoProject);
    return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, ctx.chatId)));
  }
  await deps.pluginService.bindToProject?.(project.id, pluginName, ctx.operatorId);
  log.info({ chatId: ctx.chatId, projectId: project.id, pluginName, operatorId: ctx.operatorId }, "admin_skill_bind");
  return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, ctx.chatId)));
});

register("admin_skill_unbind", "ADMIN_HELP", async (deps, ctx) => {
  const pluginName = String(ctx.actionValue.pluginName ?? "");
  const project = deps.findProjectByChatId(ctx.chatId);
  if (!pluginName || !project?.id) return;
  await deps.pluginService.unbindFromProject?.(project.id, pluginName);
  log.info({ chatId: ctx.chatId, projectId: project.id, pluginName, operatorId: ctx.operatorId }, "admin_skill_unbind");
  return rawCard(deps.feishuOutputAdapter.buildAdminSkillCard(await buildAdminSkillData(deps, ctx.chatId)));
});

register("admin_backend_validate_model", "ADMIN_HELP", (deps, ctx) =>
  handleAdminBackendValidateModel(deps, ctx.payload, ctx.chatId, ctx.actionValue));

register("admin_backend_recheck", "ADMIN_HELP", (deps, ctx) =>
  handleAdminBackendRecheck(deps, ctx.chatId, ctx.actionValue));

register("admin_backend_add_provider", "ADMIN_HELP", (deps, ctx) =>
  handleAdminBackendAddProvider(deps, ctx.payload, ctx.chatId, ctx.actionValue));

register("admin_backend_remove_provider", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const provider = String(ctx.actionValue.provider ?? "");
  if (!backend || !provider) return;
  await deps.orchestrator.adminRemoveProvider(backend, provider);
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendEditCard(data, backend));
});

register("admin_backend_model_manage", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendModelCard(data, backend));
});

register("admin_backend_remove_model", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const provider = String(ctx.actionValue.provider ?? "");
  const model = String(ctx.actionValue.model ?? "");
  if (!backend || !provider || !model) return;
  await deps.orchestrator.adminRemoveModel(backend, provider, model);
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendModelCard(data, backend));
});

register("admin_backend_policy_save", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  if (!backend) return;
  const formValues = ctx.payload.action?.form_value ?? {};
  log.info({ backendId: backend, chatId: ctx.chatId, traceId: ctx.messageId || undefined }, "admin_backend_policy_save");

  // Codex: approval_policy + sandbox_mode
  if (backend === "codex") {
    if (formValues.approval_policy) deps.orchestrator.updateBackendPolicy(backend, "approval_policy", String(formValues.approval_policy), { chatId: ctx.chatId, traceId: ctx.messageId || undefined, userId: ctx.operatorId });
    if (formValues.sandbox_mode) deps.orchestrator.updateBackendPolicy(backend, "sandbox_mode", String(formValues.sandbox_mode), { chatId: ctx.chatId, traceId: ctx.messageId || undefined, userId: ctx.operatorId });
  }
  // OpenCode: permission
  else if (backend === "opencode") {
    if (formValues.permission_question) deps.orchestrator.updateBackendPolicy(backend, "permission_question", String(formValues.permission_question), { chatId: ctx.chatId, traceId: ctx.messageId || undefined, userId: ctx.operatorId });
  }
  // Claude Code: defaultMode
  else if (backend === "claude-code") {
    if (formValues.defaultMode) deps.orchestrator.updateBackendPolicy(backend, "defaultMode", String(formValues.defaultMode), { chatId: ctx.chatId, traceId: ctx.messageId || undefined, userId: ctx.operatorId });
  }

  // Rebuild the edit card to reflect the saved values
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendEditCard(data, backend));
});

// ── Profile CRUD ────────────────────────────────────────────────────────────

register("admin_backend_add_profile", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  if (!backend) return;
  const formValues = ctx.payload.action?.form_value ?? {};
  const profileName = String(formValues.profile_name ?? "").trim();
  const profileModel = String(formValues.profile_model ?? "").trim();
  if (!profileName || !profileModel) return;
  // 接入源来自下拉框；若为空则回退到 activeProvider 或首个可用接入源
  const providerFromForm = String(formValues.profile_provider ?? "").trim();
  const configs = await deps.orchestrator.readBackendConfigs();
  const b = configs.find(c => c.name === backend);
  const providerName = providerFromForm || (b?.activeProvider ?? b?.providers[0]?.name ?? backend);

  // Collect backend-specific extras from the SAME form
  const extras: Record<string, unknown> = {};
  if (backend === "codex") {
    if (formValues.model_reasoning_effort) extras.model_reasoning_effort = String(formValues.model_reasoning_effort);
    if (formValues.personality) extras.personality = String(formValues.personality);
  } else if (backend === "opencode") {
    if (formValues.thinking_budget_tokens) extras.thinking_budget_tokens = Number(formValues.thinking_budget_tokens);
    if (formValues.context_limit) extras.context_limit = Number(formValues.context_limit);
    if (formValues.output_limit) extras.output_limit = Number(formValues.output_limit);
    // Modalities — multi_select_static returns string[]
    const modInput = Array.isArray(formValues.modalities_input) ? formValues.modalities_input : [];
    const modOutput = Array.isArray(formValues.modalities_output) ? formValues.modalities_output : [];
    if (modInput.length > 0 || modOutput.length > 0) {
      extras.modalities = { input: modInput, output: modOutput };
    }
  }

  deps.orchestrator.adminWriteProfile(backend, profileName, profileModel, providerName, extras, {
    chatId: ctx.chatId,
    traceId: ctx.messageId || undefined,
    userId: ctx.operatorId
  });
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendModelCard(data, backend));
});

register("admin_backend_remove_profile", "ADMIN_HELP", async (deps, ctx) => {
  const backend = String(ctx.actionValue.backend ?? "");
  const profileName = String(ctx.actionValue.profile ?? "");
  if (!backend || !profileName) return;
  deps.orchestrator.adminDeleteProfile(backend, profileName);
  const data = await buildAdminBackendData(deps);
  return rawCard(deps.feishuOutputAdapter.buildAdminBackendModelCard(data, backend));
});

register("admin_member_role_change", "USER_ROLE", async (deps, ctx) => {
  const targetUserId = String(ctx.actionValue.userId ?? "");
  const projectId = String(ctx.actionValue.projectId ?? "");
  const newRole = String((ctx.payload.action as Record<string, unknown>)?.option ?? "");
  if (!targetUserId || !projectId || !["maintainer", "developer", "auditor"].includes(newRole)) {
    return rawCard(deps.feishuOutputAdapter.buildAdminMemberCard(await buildAdminMemberData(deps)));
  }
  const state = deps.adminStateStore.read();
  const members = state.members[projectId] ?? [];
  const idx = members.findIndex(m => m.userId === targetUserId);
  if (idx >= 0) {
    members[idx] = { ...members[idx], role: newRole as "maintainer" | "developer" | "auditor" };
    state.members[projectId] = members;
    deps.adminStateStore.write(state);
    log.info({ targetUserId, projectId, newRole }, "admin_member_role_change");
  }
  return rawCard(deps.feishuOutputAdapter.buildAdminMemberCard(await buildAdminMemberData(deps)));
});

register("admin_toggle", "ADMIN_ADD", async (deps, ctx) => {
  const targetId = String(ctx.actionValue.userId ?? "");
  const promote = ctx.actionValue.promote === true;
  const page = Number(ctx.actionValue.page ?? 0);
  if (!targetId) return;
  if (promote) {
    deps.userRepository.setAdmin(targetId, "im");
    log.info({ targetId }, "admin_toggle: promoted");
  } else {
    const result = deps.userRepository.removeAdmin(targetId);
    log.info({ targetId, result }, "admin_toggle: demoted");
  }
  const card = deps.feishuOutputAdapter.buildAdminUserCard(await buildAdminUserData(deps, page));
  await deps.feishuAdapter.updateInteractiveCard(ctx.messageId, card);
});

register("admin_user_page", "ADMIN_HELP", async (deps, ctx) => {
  const page = Math.max(0, Number(ctx.actionValue.page ?? 0));
  const card = deps.feishuOutputAdapter.buildAdminUserCard(await buildAdminUserData(deps, page));
  await deps.feishuAdapter.updateInteractiveCard(ctx.messageId, card);
});

register("help_role_change", "USER_ROLE", async (deps, ctx) => {
  const targetUserId = String(ctx.actionValue.userId ?? "");
  const projectId = String(ctx.actionValue.projectId ?? "");
  const newRole = String((ctx.payload.action as Record<string, unknown>)?.option ?? "");
  if (!targetUserId || !projectId || !["maintainer", "developer", "auditor"].includes(newRole)) {
    return;
  }
  const state = deps.adminStateStore.read();
  const members = state.members[projectId] ?? [];
  const idx = members.findIndex(m => m.userId === targetUserId);
  if (idx >= 0) {
    members[idx] = { ...members[idx], role: newRole as "maintainer" | "developer" | "auditor" };
    state.members[projectId] = members;
    deps.adminStateStore.write(state);
    log.info({ targetUserId, projectId, newRole }, "help_role_change");
  }
  // Rebuild help card with updated members
  const updatedMembers = (state.members[projectId] ?? []).map(m => ({
    userId: m.userId, role: m.role
  }));
  return rawCard(deps.feishuOutputAdapter.buildHelpCard(ctx.operatorId, {
    isAdmin: true, members: updatedMembers, projectId
  }));
});

register("admin_project_members", "ADMIN_HELP", async (deps, ctx) => {
  const projectId = String(ctx.actionValue.projectId ?? "");
  const memberData = await buildAdminMemberData(deps);
  memberData.projects = memberData.projects.filter(p => p.projectId === projectId);
  return rawCard(deps.feishuOutputAdapter.buildAdminMemberCard(memberData));
});

// ── Admin search handlers ──

register("admin_search_project", "ADMIN_HELP", async (deps, ctx) => {
  const keyword = String(ctx.payload.action?.form_value?.search_keyword ?? "").trim();
  const data = buildAdminProjectData(deps);
  if (keyword) data.projects = data.projects.filter(p => p.name.toLowerCase().includes(keyword.toLowerCase()));
  return rawCard(deps.feishuOutputAdapter.buildAdminProjectCard(data, keyword || undefined));
});

register("admin_search_member", "ADMIN_HELP", async (deps, ctx) => {
  const keyword = String(ctx.payload.action?.form_value?.search_keyword ?? "").trim();
  const data = await buildAdminMemberData(deps);
  if (keyword) data.projects = data.projects.filter(p => p.projectName.toLowerCase().includes(keyword.toLowerCase()));
  return rawCard(deps.feishuOutputAdapter.buildAdminMemberCard(data, keyword || undefined));
});

register("admin_search_user", "ADMIN_HELP", async (deps, ctx) => {
  const keyword = String(ctx.payload.action?.form_value?.search_keyword ?? "").trim();
  if (!keyword) {
    return rawCard(deps.feishuOutputAdapter.buildAdminUserCard(await buildAdminUserData(deps)));
  }
  // displayName → userId MAP: resolve all users' names, filter matching, then query by IDs
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
  return rawCard(deps.feishuOutputAdapter.buildAdminUserCard({
    kind: "admin_user", users: enriched, total, page: 0, pageSize: USER_PAGE_SIZE
  }, keyword));
});

// ── Entry Point ────────────────────────────────────────────────────────────────

export async function handleFeishuCardAction(deps: FeishuHandlerDeps, data: Record<string, unknown>): Promise<CardActionResponse> {
  const payload = data as CardActionData;
  const actionValue = payload.action?.value ?? {};
  const action = String(actionValue.action ?? "");
  const operatorId = String(payload.operator?.open_id ?? "unknown-approver");
  const chatId = String(payload.context?.open_chat_id ?? "");
  const messageId = String(payload.context?.open_message_id ?? "");
  const actionLog = log.child({ chatId, userId: operatorId, messageId, action, traceId: messageId || undefined });

  // 1. Lookup registry — deny-by-default for unregistered actions
  const reg = actionRegistry.get(action);
  if (!reg || !chatId) return;

  // 2. Resolve role & authorize (if intent is declared)
  if (reg.intent) {
    const { GUARD } = getFeishuNotifyCatalog(deps.config.locale);
    const project = deps.findProjectByChatId(chatId);
    const role = deps.roleResolver.resolve(operatorId, project?.id, { autoRegister: true });
    try {
      authorizeIntent(role, reg.intent);
    } catch (error) {
      if (error instanceof AuthorizationError) {
        await notify(deps, chatId, GUARD.NO_PERMISSION);
        actionLog.info({ intent: reg.intent }, "card action authorization denied");
      }
      return;
    }
  }

  // 3. Dispatch
  const project = deps.findProjectByChatId(chatId);
  try {
    const result = await reg.handler(deps, { payload, action, actionValue, operatorId, chatId, messageId });
    // Audit: 记录卡片操作
    deps.auditService?.append({
      projectId: project?.id ?? "unknown",
      actorId: operatorId,
      action: `card_action:${action}`,
      result: "ok",
      traceId: messageId || undefined,
      correlationId: messageId || undefined,
      detailJson: { chatId, actionKeys: Object.keys(actionValue) }
    }).catch((auditError) => {
      actionLog.warn({ err: auditError instanceof Error ? auditError.message : String(auditError) }, "card action audit append failed");
    });
    return result;
  } catch (error) {
    actionLog.error({ err: error instanceof Error ? error.message : error }, "card action error");
    if (error instanceof TurnRecoveryError) {
      const s = getFeishuCardHandlerStrings(deps.config.locale);
      await notify(deps, chatId, s.genericError(error.message));
    }
    // Audit: 记录失败操作
    deps.auditService?.append({
      projectId: project?.id ?? "unknown",
      actorId: operatorId,
      action: `card_action:${action}`,
      result: "error",
      traceId: messageId || undefined,
      correlationId: messageId || undefined,
      detailJson: { chatId, error: error instanceof Error ? error.message : String(error) }
    }).catch((auditError) => {
      actionLog.warn({ err: auditError instanceof Error ? auditError.message : String(auditError) }, "card action error audit append failed");
    });
    return;
  }
}

/** @deprecated Use handleFeishuCardAction */
export const handleCardAction = handleFeishuCardAction;
