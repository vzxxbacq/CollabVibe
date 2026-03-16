/**
 * @module src/feishu/feishu-message-handler
 * @layer Feishu (platform-specific)
 *
 * Feishu inbound message handler — the main entry point for `im.message.receive_v1` events.
 *
 * ## Responsibilities
 * - Parse Feishu message payload (chat_id, user_id, content, mentions)
 * - Feishu-specific guards: group @mention filter, DM admin-only, message dedup
 * - Classify intent via `routeIntent()` → `dispatchIntent()` from core
 * - For agent commands: render `HandleIntentResult` → `FeishuOutputAdapter` + bind `eventPipeline`
 * - For non-agent commands: call core business logic → render via `feishuAdapter.sendMessage`
 *
 * ## Data Flow
 * ```
 * Feishu WS event → parsePayload → routeIntent → dispatchIntent(core)
 *   → agent? → orchestrator result → FeishuOutputAdapter rendering
 *   → non-agent? → core/platform-commands → feishuAdapter.sendMessage
 * ```
 *
 * ## Import Constraints
 * ✅ May import: src/core/, packages/channel-core, services/iam, services/orchestrator
 * ❌ Must NOT import: src/slack/
 *
 * ## Exports
 * - `handleFeishuMessage(deps, data)` — primary export
 * - `handleInboundMessage` — deprecated alias for backward compatibility
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { routeIntent } from "../../packages/channel-core/src/intent-router";
import { createLogger } from "../../packages/channel-core/src/index";
import type { EffectiveRole } from "../../services/iam/src/permissions";
import { AuthorizationError } from "../../services/iam/src/authorize";
import { OrchestratorError } from "../../services/orchestrator/src/errors";
import { ResultMode } from "../../services/orchestrator/src/intent/result";
import { PLUGIN_STAGING_SCOPE } from "../../services/plugin/src/index";
import { dispatchIntent } from "../core/intent-dispatcher";
import {
  handleUserIntent as handleUserIntentCore,
  handleAdminIntent as handleAdminIntentCore
} from "../core/platform-commands";
import { createProject } from "../core/platform-commands";

import type { FeishuHandlerDeps } from "./types";
import { resolveHelpCard, resolveHelpSkillCard, sendThreadNewForm } from "./shared-handlers";
import { listSkills, installSkill, removeSkill } from "../core/platform-commands";
import { notify, GUARD, OP, ERR, ORCHESTRATOR_ERROR_MAP } from "./feishu-notify";
import { consumePendingFeishuSkillInstall, peekPendingFeishuSkillInstall, stageFeishuSkillInstall } from "./skill-file-install-state";
import { getFeishuMessageHandlerStrings } from "./feishu-message-handler.strings";

const log = createLogger("handler");

async function sendProjectHelpCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<void> {
  const card = await resolveHelpCard(deps, chatId, userId);
  await deps.feishuAdapter.sendInteractiveCard(chatId, card);
}

interface InboundMessageData {
  message?: {
    chat_id?: string;
    chat_type?: string;
    content?: string;
    message_id?: string;
    message_type?: string;
    mentions?: Array<{ key?: string; id?: { open_id?: string }; name?: string }>;
  };
  sender?: { sender_id?: { open_id?: string } };
}

function parseText(rawContent: string): string {
  try {
    return String((JSON.parse(rawContent) as { text?: string }).text ?? "");
  } catch {
    return rawContent;
  }
}

function parseFileContent(rawContent: string): { fileKey?: string; fileName?: string } {
  try {
    const parsed = JSON.parse(rawContent) as { file_key?: string; file_name?: string };
    return { fileKey: parsed.file_key, fileName: parsed.file_name };
  } catch {
    return {};
  }
}

function isSupportedSkillArchiveName(fileName?: string): boolean {
  return Boolean(fileName && /\.(zip|tgz|tar\.gz)$/i.test(fileName));
}

function archiveFormatLabel(locale: "zh-CN" | "en-US", fileName?: string): string {
  const s = getFeishuMessageHandlerStrings(locale);
  if (!fileName) return s.unknownArchive;
  if (/\.tar\.gz$/i.test(fileName)) return s.archiveTarGz;
  if (/\.tgz$/i.test(fileName)) return s.archiveTgz;
  if (/\.zip$/i.test(fileName)) return s.archiveZip;
  return s.unknownArchive;
}

function isPlanTurnText(text: string): boolean {
  return /^\s*\/plan(?:\s+|$)/.test(text);
}

function normalizeTurnPrompt(locale: "zh-CN" | "en-US", text: string): string {
  const match = /^\s*\/plan(?:\s+|$)/.exec(text);
  if (!match) return text;
  const s = getFeishuMessageHandlerStrings(locale);
  return text.slice(match[0].length).trim() || s.planPromptFallback;
}

async function handlePendingSkillFileUpload(
  deps: FeishuHandlerDeps,
  input: {
    chatId: string;
    userId: string;
    messageId: string;
    fileKey: string;
    fileName?: string;
  }
): Promise<boolean> {
  const s = getFeishuMessageHandlerStrings(deps.config.locale);
  const pending = peekPendingFeishuSkillInstall(input.chatId, input.userId);
  if (!pending) return false;
  consumePendingFeishuSkillInstall(input.chatId, input.userId);
  if (!deps.pluginService.allocateStagingDir) {
    throw new Error(s.skillStagingUnavailable);
  }
  const tempDir = await deps.pluginService.allocateStagingDir(PLUGIN_STAGING_SCOPE.FEISHU_UPLOAD, input.userId);
  await mkdir(tempDir, { recursive: true });
  try {
    if (!isSupportedSkillArchiveName(input.fileName)) {
      throw new Error(s.unsupportedSkillArchive(input.fileName ?? "unnamed file"));
    }
    const downloaded = await deps.feishuAdapter.downloadMessageFile({
      messageId: input.messageId,
      fileKey: input.fileKey,
      targetDir: tempDir,
      fileName: input.fileName,
    });
    if (!deps.pluginService.inspectLocalSource) {
      throw new Error(s.skillManifestUnavailable);
    }
    const inspected = await deps.pluginService.inspectLocalSource({
      localPath: downloaded.localPath,
      sourceType: "feishu-upload",
      preferredPluginName: pending.pluginName,
      extractionDir: join(tempDir, "resolved-skill"),
    });
    const project = deps.findProjectByChatId(input.chatId);
    stageFeishuSkillInstall({
      chatId: input.chatId,
      userId: input.userId,
      pluginName: inspected.resolvedPluginName,
      autoEnableProjectId: pending.autoEnableProjectId,
      localPath: inspected.resolvedLocalPath,
      tempDir,
      originalName: downloaded.originalName,
      manifestName: inspected.manifestName,
      manifestDescription: inspected.manifestDescription,
      onExpire: (staged) => {
        void rm(staged.tempDir, { recursive: true, force: true }).catch((error) => {
          log.warn({ chatId: input.chatId, userId: input.userId, err: error instanceof Error ? error.message : String(error) }, "skill install temp dir cleanup failed");
        });
        void notify(deps, input.chatId, s.skillFileInstallTimeoutUploaded);
      },
    });
    const confirmCard = deps.feishuOutputAdapter.buildAdminSkillFileConfirmCard
      ? deps.feishuOutputAdapter.buildAdminSkillFileConfirmCard({
        fileName: downloaded.originalName ?? downloaded.localPath,
        pluginName: inspected.resolvedPluginName,
        manifestName: inspected.manifestName,
        manifestDescription: inspected.manifestDescription,
        sourceLabel: s.feishuFileSourceLabel,
        archiveFormat: archiveFormatLabel(deps.config.locale, downloaded.originalName ?? input.fileName),
        autoEnableProject: Boolean(pending.autoEnableProjectId),
        projectName: pending.autoEnableProjectId ? project?.name : undefined,
        expiresHint: s.skillInstallExpiresHint,
      })
      : undefined;
    if (confirmCard) {
      await deps.feishuAdapter.sendInteractiveCard(input.chatId, confirmCard);
    } else {
      await notify(deps, input.chatId, s.skillFileInstallReceived(downloaded.originalName ?? downloaded.localPath));
    }
  } catch (error) {
    await notify(deps, input.chatId, s.skillFileInstallFailed(error instanceof Error ? error.message : String(error)));
    await rm(tempDir, { recursive: true, force: true }).catch((error) => {
      log.warn({ chatId: input.chatId, userId: input.userId, err: error instanceof Error ? error.message : String(error) }, "skill upload temp dir cleanup failed");
    });
  }
  return true;
}

async function handleNonCodexIntent(
  deps: FeishuHandlerDeps,
  chatId: string,
  userId: string,
  intent: { intent: string; args: Record<string, unknown> },
  role: EffectiveRole | null
): Promise<void> {
  if (intent.intent === "PROJECT_CREATE") {
    const name = String(intent.args.name ?? "").replace(/[<>'";&|`$\\]/g, "");
    const cwd = String(intent.args.cwd ?? "").replace(/[<>'";&|`$\\]/g, "");
    const result = await createProject(deps, chatId, userId, { name, cwd });
    if (result.success && result.project) {
      await notify(deps, chatId, OP.PROJECT_CREATED(result.project));
      await sendProjectHelpCard(deps, chatId, userId);
    } else {
      await notify(deps, chatId, `⚠️ ${result.message}`);
    }
    return;
  }

  if (intent.intent === "HELP") {
    const card = await resolveHelpCard(deps, chatId, userId);
    await deps.feishuAdapter.sendInteractiveCard(chatId, card);
    return;
  }

  await notify(deps, chatId, OP.FALLBACK_HELP);
}

async function handleSkillIntent(
  deps: FeishuHandlerDeps,
  chatId: string,
  userId: string,
  intent: { intent: string; args: Record<string, unknown> }
): Promise<void> {
  const s = getFeishuMessageHandlerStrings(deps.config.locale);
  switch (intent.intent) {
    case "SKILL_LIST": {
      const card = await resolveHelpSkillCard(deps, chatId, userId);
      await deps.feishuAdapter.sendInteractiveCard(chatId, card);
      return;
    }
    case "SKILL_INSTALL": {
      const source = String(intent.args.source ?? "");
      if (!source) {
        await notify(deps, chatId, s.skillNameRequired);
        return;
      }
      try {
        const project = deps.findProjectByChatId(chatId);
        const def = await deps.pluginService.install(source, project?.id, userId);
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
      return;
    }
    case "SKILL_REMOVE": {
      const name = String(intent.args.name ?? "");
      if (!name) {
        await notify(deps, chatId, s.pluginNameRequired);
        return;
      }
      try {
        const project = deps.findProjectByChatId(chatId);
        const removed = project?.id
          ? await deps.pluginService.unbindFromProject?.(project.id, name)
          : await deps.pluginService.remove(name);
        if (removed) {
          await deps.feishuOutputAdapter.sendSkillOperation(chatId, {
            kind: "skill_operation",
            action: "removed",
            skill: { name, description: "", installed: false }
          });
        } else {
          await notify(deps, chatId, s.pluginNotFound(name));
        }
      } catch (error) {
        await notify(deps, chatId, s.removeFailed(error instanceof Error ? error.message : String(error)));
      }
      return;
    }
    case "SKILL_ADMIN": {
      // Admin skill panel — currently only accessible via card actions in the admin DM flow
      const card = await resolveHelpSkillCard(deps, chatId, userId);
      await deps.feishuAdapter.sendInteractiveCard(chatId, card);
      return;
    }
  }
}



export async function handleFeishuMessage(deps: FeishuHandlerDeps, data: Record<string, unknown>): Promise<void> {
  try {
    const s = getFeishuMessageHandlerStrings(deps.config.locale);
    const payload = data as InboundMessageData;
    const messageData = payload.message;
    const senderData = payload.sender;
    const messageId = String(messageData?.message_id ?? "");
    const messageType = String(messageData?.message_type ?? "text");
    if (messageId && deps.recentMessageIds.has(messageId)) {
      return;
    }
    if (messageId) {
      deps.recentMessageIds.add(messageId);
      setTimeout(() => deps.recentMessageIds.delete(messageId), deps.messageDedupTtlMs);
    }

    const chatId = String(messageData?.chat_id ?? "");
    const userId = String(senderData?.sender_id?.open_id ?? "");
    const chatType = String(messageData?.chat_type ?? "");
    const traceId = messageId || `stream-${Date.now()}`;
    const requestLog = log.child({ chatId, userId, messageId, traceId });
    requestLog.info({ text: String(messageData?.content ?? "").slice(0, 60), chatType, messageType }, "inbound message");

    if (messageType === "file") {
      const file = parseFileContent(String(messageData?.content ?? "{}"));
      if (chatType === "p2p" && messageId && file.fileKey) {
        const handled = await handlePendingSkillFileUpload(deps, {
          chatId,
          userId,
          messageId,
          fileKey: file.fileKey,
          fileName: file.fileName,
        });
        if (handled) return;
      }
      if (chatType === "p2p") {
        requestLog.info("dm.ignored: file upload not armed");
        return;
      }
    }

    let text = parseText(String(messageData?.content ?? "{}"));
    const hasMention = Array.isArray(messageData?.mentions) && messageData.mentions.length > 0;
    if (chatType === "group" && !hasMention) {
      return;
    }
    text = text.replace(/@_user_\d+/g, "").trim();

    // DM 不接受文本命令 — admin 通过 bot 菜单操作管理面板
    if (chatType === "p2p") {
      requestLog.info("dm.ignored: text commands disabled");
      return;
    }

    // @bot 空消息 → 显示 help card
    if (!text) {
      const project = deps.findProjectByChatId(chatId);
      deps.roleResolver?.resolve?.(userId, project?.id, { autoRegister: true });
      const card = await resolveHelpCard(deps, chatId, userId);
      await deps.feishuAdapter.sendInteractiveCard(chatId, card);
      return;
    }

    const project = deps.findProjectByChatId(chatId);
    if (project?.status === "disabled") {
      const s = getFeishuMessageHandlerStrings(deps.config.locale);
      await deps.feishuAdapter.sendMessage({ chatId, text: s.projectDisabled });
      return;
    }
    const projectId = project?.id ?? "default-project";
    const role = deps.roleResolver?.resolve?.(userId, project?.id, { autoRegister: true }) ?? "developer";

    const message: Parameters<typeof routeIntent>[0] = {
      channel: "feishu" as const,
      eventId: `stream-${Date.now()}`,
      traceId,
      chatId,
      userId,
      timestamp: Date.now(),
      raw: data,
      type: "text" as const,
      text,
      mentions: []
    };

    const intent = routeIntent(message);

    // Audit: 记录用户命令/消息
    deps.auditService?.append({
      projectId,
      actorId: userId,
      action: `user_message:${intent.intent}`,
      result: "ok",
      traceId,
      correlationId: traceId,
      detailJson: { chatId, text: text.slice(0, 200), type: message.type }
    }).catch((error) => {
      requestLog.warn({ err: error instanceof Error ? error.message : String(error) }, "audit append failed");
    });

    // ── Pre-flight guards: check thread state BEFORE calling handleIntent ──
    // handleIntent → ensureCanStartTurn() would throw generic errors;
    // these guards produce friendly user-facing messages instead.
    let preflightThreadId: string | null = null;
    let preflightThreadName: string | null = null;
    let displayBackend: string | undefined;
    let displayModel: string | undefined;
    if (userId && intent.intent === "TURN_START") {
      const selected = await deps.orchestrator.getUserActiveThread(chatId, userId);
      if (selected) {
        preflightThreadId = selected.threadId;
        preflightThreadName = selected.threadName;

        if (deps.orchestrator.isPendingApproval(chatId, selected.threadName)) {
          await notify(deps, chatId, GUARD.PENDING_APPROVAL(selected.threadName));
          return;
        }

        const threadState = deps.orchestrator.getConversationState(chatId, selected.threadName);
        if (threadState === "RUNNING") {
          await notify(deps, chatId, GUARD.THREAD_RUNNING(selected.threadName));
          return;
        }

        // Capture backend/model for per-turn card display (applied after turn ID is known)
        displayBackend = selected.backend.backendId;
        displayModel = selected.backend.model;
      }
    }

    const normalizedText = normalizeTurnPrompt(deps.config.locale, text);
    const isPlanTurn = isPlanTurnText(text);

    const dispatch = await dispatchIntent(deps, {
      projectId, chatId, userId, text,
      traceId: message.traceId ?? message.eventId,
      messageType: message.type,
      role
    }, intent);

    if (!dispatch.routed) {
      if (["USER_LIST", "USER_ROLE", "USER_ADD", "USER_REMOVE"].includes(dispatch.intent.intent)) {
        const result = handleUserIntentCore(deps, chatId, userId, dispatch.intent);
        await notify(deps, chatId, result.text);
      } else if (["ADMIN_ADD", "ADMIN_REMOVE", "ADMIN_LIST"].includes(dispatch.intent.intent)) {
        const result = handleAdminIntentCore(deps, dispatch.intent);
        await notify(deps, chatId, result.text);
      } else if (["SKILL_LIST", "SKILL_INSTALL", "SKILL_REMOVE", "SKILL_ADMIN"].includes(dispatch.intent.intent)) {
        await handleSkillIntent(deps, chatId, userId, dispatch.intent);
      } else {
        await handleNonCodexIntent(deps, chatId, userId, dispatch.intent, role);
      }
      return;
    }

    const result = dispatch.result;

    if (result.mode === ResultMode.THREAD_NEW_FORM) {
      await sendThreadNewForm(deps, chatId, userId);
      return;
    }

    if (result.mode === ResultMode.THREAD_CREATED) {
      await deps.feishuOutputAdapter.sendThreadOperation(chatId, {
        kind: "thread_operation",
        action: "created",
        thread: { threadId: result.id, threadName: result.threadName }
      });
      return;
    }

    if (result.mode === ResultMode.THREAD_JOINED || result.mode === ResultMode.THREAD_RESUMED) {
      await deps.feishuOutputAdapter.sendThreadOperation(chatId, {
        kind: "thread_operation",
        action: result.mode === ResultMode.THREAD_RESUMED ? "resumed" : "joined",
        thread: { threadId: result.id, threadName: result.threadName }
      });
      return;
    }

    if (result.mode === ResultMode.THREAD_LIST) {
      const threads = await deps.orchestrator.handleThreadList(chatId);
      const activeBinding = userId ? await deps.orchestrator.getUserActiveThread(chatId, userId) : null;
      await deps.feishuOutputAdapter.sendThreadOperation(chatId, {
        kind: "thread_operation",
        action: "listed",
        threads: threads.map((thread) => ({
          threadName: thread.threadName,
          threadId: thread.threadId,
          active: activeBinding?.threadId === thread.threadId
        }))
      }, userId);
      return;
    }

    if (result.mode === ResultMode.MERGE_PREVIEW) {
      await deps.feishuOutputAdapter.sendMergeOperation(chatId, {
        kind: "thread_merge",
        action: "preview",
        branchName: result.id,
        baseBranch: typeof (result as { baseBranch?: unknown }).baseBranch === "string" ? (result as { baseBranch: string }).baseBranch : "main",
        message: s.mergePreviewPending,
        diffStats: result.diffStats
      });
      return;
    }

    if (result.mode === ResultMode.MERGE_FILE_REVIEW) {
      await deps.feishuOutputAdapter.sendFileReview(chatId, result.fileReview);
      return;
    }

    if (result.mode === ResultMode.MERGE_RESOLVING) {
      const conflictList = result.conflicts.map(f => `• \`${f}\``).join("\n");
      await deps.feishuAdapter.sendMessage({
        chatId,
        text: s.mergeResolving(result.conflicts.length, conflictList)
      });
      return;
    }

    if (result.mode === ResultMode.MERGE_CONFLICT) {
      await deps.feishuOutputAdapter.sendMergeOperation(chatId, {
        kind: "thread_merge",
        action: "conflict",
        branchName: result.id,
        baseBranch: typeof (result as { baseBranch?: unknown }).baseBranch === "string" ? (result as { baseBranch: string }).baseBranch : "main",
        message: result.message ?? (result.resolverThread ? s.mergeConflictDetected : s.mergeFailed),
        conflicts: result.conflicts,
        resolverThread: result.resolverThread
      });

      // Bind event pipeline for the resolver thread so its agent events are routed to card updates
      if (result.resolverThread) {
        const resolverThreadId = result.resolverThread.threadId;
        const resolverThreadName = result.resolverThread.threadName;
        const baseCwd = project?.cwd ?? deps.config.cwd;
        const resolverCwd = `${baseCwd}--${resolverThreadName}`;

        // Record the turn start for snapshot/revert support
        // The turnId for the resolver is its sessionId (returned by AcpClient.prompt)
        await deps.orchestrator.recordTurnStart(projectId, chatId, resolverThreadName, resolverThreadId, resolverThreadId, resolverCwd, userId, traceId);

        deps.orchestrator.bindTurnPipeline({
          chatId,
          userId,
          traceId,
          threadName: resolverThreadName,
          threadId: resolverThreadId,
          turnId: resolverThreadId,
          cwd: resolverCwd,
          isMergeResolver: true
        });
        deps.feishuOutputAdapter.setCardThreadName(chatId, resolverThreadId, resolverThreadName);
        requestLog.info({ resolverThreadId, resolverThreadName }, "eventPipeline bound for merge-resolver");
      }
      return;
    }

    if (result.mode === ResultMode.MERGE_SUCCESS) {
      await deps.feishuOutputAdapter.sendMergeOperation(chatId, {
        kind: "thread_merge",
        action: "success",
        branchName: result.id,
        baseBranch: typeof (result as { baseBranch?: unknown }).baseBranch === "string" ? (result as { baseBranch: string }).baseBranch : "main",
        message: result.message ?? s.mergeDone
      });
      return;
    }

    if (result.mode !== ResultMode.TURN) {
      return;
    }

    // Use pre-resolved thread info from preflight, or fall back to re-resolve
    const threadId = preflightThreadId ?? result.id;
    const threadName = preflightThreadName;

    if (!threadId) {
      throw new Error(s.threadJoinHint);
    }

    const turnLog = requestLog.child({ threadId, threadName: threadName ?? threadId, turnId: result.id });
    turnLog.info("turn started");

    const baseCwd = project?.cwd ?? deps.config.cwd;
    const turnCwd = threadName && threadName !== threadId ? `${baseCwd}--${threadName}` : baseCwd;
    await deps.orchestrator.recordTurnStart(projectId, chatId, threadName ?? threadId, threadId, result.id, turnCwd, userId, traceId);

    deps.orchestrator.bindTurnPipeline({
      chatId,
      userId,
      threadName: threadName ?? threadId,
      threadId,
      turnId: result.id,
      cwd: turnCwd,
      turnMode: isPlanTurn ? "plan" : undefined
    });
    if (threadName && threadName !== threadId) {
      deps.feishuOutputAdapter.setCardThreadName(chatId, result.id, threadName);
    }
    // Set per-turn backend/model info on the card (not shared across turns)
    if (displayBackend || displayModel) {
      deps.feishuOutputAdapter.setCardBackendInfo(
        chatId, result.id, displayBackend ?? "", displayModel ?? ""
      );
    }
    if (isPlanTurn) {
      deps.feishuOutputAdapter.setCardTurnMode(chatId, result.id, "plan");
    }
    // Set prompt summary from user's text (header shows what user asked)
    deps.feishuOutputAdapter.setCardPromptSummary(chatId, result.id, normalizedText);
    await deps.orchestrator.updateTurnMetadata(chatId, result.id, {
      promptSummary: normalizedText,
      backendName: displayBackend ?? undefined,
      modelName: displayModel ?? undefined,
      turnMode: isPlanTurn ? "plan" : undefined
    });
    turnLog.info("eventPipeline bound");
  } catch (error) {
    const chatId = String((data as InboundMessageData).message?.chat_id ?? "");
    const messageId = String((data as InboundMessageData).message?.message_id ?? "");
    const userId = String((data as InboundMessageData).sender?.sender_id?.open_id ?? "");
    const requestLog = log.child({ chatId, userId, messageId, traceId: messageId || undefined });
    if (error instanceof AuthorizationError) {
      requestLog.info({ err: error.message }, "authorization denied");
      if (chatId) {
        try { await notify(deps, chatId, GUARD.NO_PERMISSION); } catch (notifyError) {
          requestLog.warn({ err: notifyError instanceof Error ? notifyError.message : String(notifyError) }, "authorization denied notify failed");
        }
      }
      return;
    }
    // Map known orchestrator errors to friendly notifications
    if (error instanceof OrchestratorError) {
      requestLog.info({ code: error.code, err: error.message }, "orchestrator error");
      if (chatId) {
        const friendly = ORCHESTRATOR_ERROR_MAP[error.code];
        try { await notify(deps, chatId, friendly ?? ERR.generic(error.message)); } catch (notifyError) {
          requestLog.warn({ err: notifyError instanceof Error ? notifyError.message : String(notifyError), code: error.code }, "orchestrator error notify failed");
        }
      }
      return;
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    requestLog.error({ err: errorMsg }, "handler error");
    if (chatId) {
      try { await notify(deps, chatId, ERR.generic(errorMsg)); } catch (notifyError) {
        requestLog.warn({ err: notifyError instanceof Error ? notifyError.message : String(notifyError) }, "generic error notify failed");
      }
    }
  }
}

/** @deprecated Use handleFeishuMessage */
export const handleInboundMessage = handleFeishuMessage;
