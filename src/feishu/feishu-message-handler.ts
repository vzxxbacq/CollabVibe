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
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

import { routeIntent } from "../common/intent-router";
import type { PlatformMessageInput } from "../common/platform-input";
import { createLogger } from "../logging";
import { FeishuInboundAdapter } from "./channel/index";
import type { EffectiveRole } from "../../services/index";
import { AuthorizationError } from "../../services/index";
import { OrchestratorError } from "../../services/index";
import { ResultMode } from "../common/result";
import type { HandleIntentResult } from "../common/result";
import { FEISHU_PLUGIN_STAGING_SCOPE } from "./plugin-staging-scope";
import { dispatchIntent } from "../common/dispatcher";
import { PlatformInputRouter } from "../common/platform-input-router";
import {
  handleUserIntentOutput,
  handleAdminIntentOutput
} from "../common/platform-commands";
import { createProject } from "../common/platform-commands";

import type { FeishuHandlerDeps } from "./types";
import { resolveHelpCard, resolveHelpSkillCard, sendThreadNewForm } from "./shared-handlers";
import { listSkills, installSkill, removeSkill } from "../common/platform-commands";
import { getFeishuNotifyCatalog, notify } from "./feishu-notify";
import { consumePendingFeishuSkillInstall, peekPendingFeishuSkillInstall, stageFeishuSkillInstall } from "./skill-file-install-state";
import { getFeishuMessageHandlerStrings } from "./feishu-message-handler.strings";
import { FeishuOutputGateway } from "./platform-output-dispatcher";
import { resolveProjectByChatId } from "../common/project-resolution";
import { textNotification } from "../common/output-helpers";

const log = createLogger("handler");
const feishuInboundAdapter = new FeishuInboundAdapter();
const feishuInputRouter = new PlatformInputRouter<FeishuHandlerDeps>({
  handleMessage: async (deps, input) => handleFeishuMessageLegacy(deps, input.raw as Record<string, unknown>)
});

async function sendProjectHelpCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<void> {
  const card = await resolveHelpCard(deps, chatId, userId);
  const dispatcher = new FeishuOutputGateway(deps);
  await dispatcher.dispatch(chatId, { kind: "help_panel", panel: card });
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
  } catch (error) {
    log.debug({ err: error instanceof Error ? error.message : String(error) }, "parseText: falling back to raw content");
    return rawContent;
  }
}

function parseFileContent(rawContent: string): { fileKey?: string; fileName?: string } {
  try {
    const parsed = JSON.parse(rawContent) as { file_key?: string; file_name?: string };
    return { fileKey: parsed.file_key, fileName: parsed.file_name };
  } catch (error) {
    log.debug({ err: error instanceof Error ? error.message : String(error) }, "parseFileContent: failed to parse file payload");
    return {};
  }
}

function requireBoundProject(
  deps: FeishuHandlerDeps,
  chatId: string
){
  const project = resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    throw new Error(`project binding not found for chatId=${chatId}`);
  }
  return project;
}

function resolveRequiredRole(
  deps: FeishuHandlerDeps,
  userId: string,
  projectId?: string
): EffectiveRole {
  const role = deps.api.resolveRole({ userId, projectId });
  if (!role) {
    throw new Error(`role resolution failed for userId=${userId} projectId=${projectId ?? "global"}`);
  }
  return role as EffectiveRole;
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
  if (!deps.api.allocateStagingDir) {
    throw new Error(s.skillStagingUnavailable);
  }
  const tempDir = await deps.api.allocateStagingDir(FEISHU_PLUGIN_STAGING_SCOPE, input.userId);
  await mkdir(tempDir, { recursive: true });
  const dispatcher = new FeishuOutputGateway(deps);
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
    if (!deps.api.inspectLocalSource) {
      throw new Error(s.skillManifestUnavailable);
    }
    const inspected = await deps.api.inspectLocalSource({
      localPath: downloaded.localPath,
      sourceType: "feishu-upload",
      preferredPluginName: pending.pluginName,
      extractionDir: join(tempDir, "resolved-skill"),
    });
    const project = resolveProjectByChatId(deps.api, input.chatId);
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
        void dispatcher.dispatch(input.chatId, textNotification(s.skillFileInstallTimeoutUploaded));
      },
    });
    const confirmCard = deps.platformOutput.buildAdminSkillFileConfirmCard
      ? deps.platformOutput.buildAdminSkillFileConfirmCard({
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
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel: confirmCard });
    } else {
      await dispatcher.dispatch(input.chatId, {
        ...textNotification(s.skillFileInstallReceived(downloaded.originalName ?? downloaded.localPath))
      });
    }
  } catch (error) {
    await dispatcher.dispatch(input.chatId, {
      ...textNotification(s.skillFileInstallFailed(error instanceof Error ? error.message : String(error)))
    });
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
  const dispatcher = new FeishuOutputGateway(deps);
  const { OP } = getFeishuNotifyCatalog(deps.config.locale);
  if (intent.intent === "PROJECT_CREATE") {
    const name = String(intent.args.name ?? "").replace(/[<>'";&|`$\\]/g, "");
    const cwd = String(intent.args.cwd ?? "").replace(/[<>'";&|`$\\]/g, "");
    const result = await createProject(deps, chatId, userId, { name, cwd });
    if (result.success && result.project) {
      await dispatcher.dispatch(chatId, textNotification(OP.PROJECT_CREATED(result.project)));
      await sendProjectHelpCard(deps, chatId, userId);
    } else {
      await dispatcher.dispatch(chatId, textNotification(`⚠️ ${result.message}`));
    }
    return;
  }

  if (intent.intent === "HELP") {
    const card = await resolveHelpCard(deps, chatId, userId);
    await dispatcher.dispatch(chatId, { kind: "help_panel", panel: card });
    return;
  }

  await dispatcher.dispatch(chatId, textNotification(OP.FALLBACK_HELP));
}

async function handleSkillIntent(
  deps: FeishuHandlerDeps,
  chatId: string,
  userId: string,
  intent: { intent: string; args: Record<string, unknown> }
): Promise<void> {
  const s = getFeishuMessageHandlerStrings(deps.config.locale);
  const dispatcher = new FeishuOutputGateway(deps);
  switch (intent.intent) {
    case "SKILL_LIST": {
      const card = await resolveHelpSkillCard(deps, chatId, userId);
      const dispatcher = new FeishuOutputGateway(deps);
      await dispatcher.dispatch(chatId, { kind: "help_panel", panel: card });
      return;
    }
    case "SKILL_INSTALL": {
      const source = String(intent.args.source ?? "");
      if (!source) {
        await dispatcher.dispatch(chatId, textNotification(s.skillNameRequired));
        return;
      }
      try {
        const project = resolveProjectByChatId(deps.api, chatId);
        const def = await deps.api.installSkill({ source, projectId: project?.id, userId, actorId: userId });
        await deps.platformOutput.sendSkillOperation(chatId, {
          kind: "skill_operation",
          action: "installed",
          skill: { name: def.name ?? source, description: def.description ?? "", installed: true }
        });
      } catch (error) {
        await deps.platformOutput.sendSkillOperation(chatId, {
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
        await dispatcher.dispatch(chatId, textNotification(s.pluginNameRequired));
        return;
      }
      try {
        const project = resolveProjectByChatId(deps.api, chatId);
        const removed = project?.id
          ? await deps.api.unbindSkillFromProject({ projectId: project.id, skillName: name, actorId: userId })
          : await deps.api.removeSkill({ name, actorId: userId });
        if (removed) {
          await deps.platformOutput.sendSkillOperation(chatId, {
            kind: "skill_operation",
            action: "removed",
            skill: { name, description: "", installed: false }
          });
        } else {
          await dispatcher.dispatch(chatId, textNotification(s.pluginNotFound(name)));
        }
      } catch (error) {
        await dispatcher.dispatch(chatId, {
          ...textNotification(s.removeFailed(error instanceof Error ? error.message : String(error)))
        });
      }
      return;
    }
    case "SKILL_ADMIN": {
      // Admin skill panel — currently only accessible via card actions in the admin DM flow
      const card = await resolveHelpSkillCard(deps, chatId, userId);
      const dispatcher = new FeishuOutputGateway(deps);
      await dispatcher.dispatch(chatId, { kind: "help_panel", panel: card });
      return;
    }
  }
}



async function handleFeishuMessageLegacy(deps: FeishuHandlerDeps, data: Record<string, unknown>): Promise<void> {
  try {
    const s = getFeishuMessageHandlerStrings(deps.config.locale);
    const { GUARD, OP, ERR, ORCHESTRATOR_ERROR_MAP } = getFeishuNotifyCatalog(deps.config.locale);
    const dispatcher = new FeishuOutputGateway(deps);
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
      const project = resolveProjectByChatId(deps.api, chatId);
      deps.api.resolveRole({ userId, projectId: project?.id });
      const card = await resolveHelpCard(deps, chatId, userId);
      const dispatcher = new FeishuOutputGateway(deps);
      await dispatcher.dispatch(chatId, { kind: "help_panel", panel: card });
      return;
    }

    const project = resolveProjectByChatId(deps.api, chatId);
    if (project?.status === "disabled") {
      const s = getFeishuMessageHandlerStrings(deps.config.locale);
      const dispatcher = new FeishuOutputGateway(deps);
      await dispatcher.dispatch(chatId, textNotification(s.projectDisabled));
      return;
    }
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
    const projectRequiredIntents = new Set([
      "TURN_START",
      "THREAD_NEW",
      "THREAD_LIST",
      "THREAD_SWITCH",
      "MODEL_LIST",
      "SNAPSHOT_LIST",
      "MERGE",
      "MERGE_PREVIEW",
      "MERGE_CONFIRM",
      "MERGE_ABORT",
      "MERGE_REVIEW",
      "MERGE_DECIDE",
      "MERGE_ACCEPT_ALL",
      "MERGE_COMMIT",
      "MERGE_CANCEL",
      "MERGE_AGENT",
      "SKILL_LIST",
      "SKILL_INSTALL",
      "SKILL_REMOVE",
      "SKILL_ADMIN",
      "USER_LIST",
      "USER_ROLE",
      "USER_ADD",
      "USER_REMOVE"
    ]);
    const boundProject = projectRequiredIntents.has(intent.intent) ? requireBoundProject(deps, chatId) : project;
    const role = resolveRequiredRole(deps, userId, boundProject?.id);

    // Audit: 记录用户命令/消息
    if (boundProject) {
      log.info({
        projectId: boundProject.id,
      actorId: userId,
      action: `user_message:${intent.intent}`,
      result: "ok",
      traceId,
      correlationId: traceId,
      detailJson: { chatId, text: text.slice(0, 200), type: message.type }
      });
    }

    // ── Pre-flight guards: check thread state BEFORE calling handleIntent ──
    // handleIntent → ensureCanStartTurn() would throw generic errors;
    // these guards produce friendly user-facing messages instead.
    let preflightThreadId: string | null = null;
    let preflightThreadName: string | null = null;
    let displayBackend: string | undefined;
    let displayModel: string | undefined;
    if (userId && intent.intent === "TURN_START") {
      const selected = await deps.api.getUserActiveThread({ projectId: boundProject!.id, userId });
      if (selected) {
        preflightThreadId = selected.threadId;
        preflightThreadName = selected.threadName;

        if (deps.api.isPendingApproval({ projectId: boundProject!.id, threadName: selected.threadName })) {
          await dispatcher.dispatch(chatId, textNotification(GUARD.PENDING_APPROVAL(selected.threadName)));
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
      projectId: boundProject?.id ?? "", chatId, userId, text,
      traceId: message.traceId ?? message.eventId,
      platform: "feishu",
      messageId,
      messageType: message.type,
      role
    }, intent);

    if (!dispatch.routed) {
      const outputDispatcher = new FeishuOutputGateway(deps);
      if (["USER_LIST", "USER_ROLE", "USER_ADD", "USER_REMOVE"].includes(dispatch.intent.intent)) {
        await outputDispatcher.dispatch(chatId, handleUserIntentOutput(deps, chatId, userId, dispatch.intent));
      } else if (["ADMIN_ADD", "ADMIN_REMOVE", "ADMIN_LIST"].includes(dispatch.intent.intent)) {
        await outputDispatcher.dispatch(chatId, handleAdminIntentOutput(deps, dispatch.intent));
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
      await deps.platformOutput.sendThreadOperation(chatId, {
        kind: "thread_operation",
        action: "created",
        thread: { threadId: result.id, threadName: result.threadName }
      });
      return;
    }

    if (result.mode === ResultMode.THREAD_JOINED || result.mode === ResultMode.THREAD_RESUMED) {
      await deps.platformOutput.sendThreadOperation(chatId, {
        kind: "thread_operation",
        action: result.mode === ResultMode.THREAD_RESUMED ? "resumed" : "joined",
        thread: { threadId: result.id, threadName: result.threadName }
      });
      return;
    }

    if (result.mode === ResultMode.THREAD_LIST) {
      const threads = await deps.api.listThreads({ projectId: boundProject!.id, actorId: userId });
      const activeBinding = userId ? await deps.api.getUserActiveThread({ projectId: boundProject!.id, userId }) : null;
      await deps.platformOutput.sendThreadOperation(chatId, {
        kind: "thread_operation",
        action: "listed",
        threads: threads.map((thread) => ({
          threadName: thread.threadName,
          threadId: thread.threadId,
          status: thread.status,
          backendName: thread.backendId,
          modelName: thread.model,
          active: thread.status === "active" && activeBinding?.threadId === thread.threadId
        }))
      }, userId);
      return;
    }

    if (result.mode === ResultMode.MERGE_PREVIEW) {
      await dispatcher.dispatch(chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "preview",
            branchName: result.id,
            baseBranch: typeof (result as { baseBranch?: unknown }).baseBranch === "string" ? (result as { baseBranch: string }).baseBranch : "main",
            message: s.mergePreviewPending,
            diffStats: result.diffStats
          }
        }
      });
      return;
    }

    if (result.mode === ResultMode.MERGE_FILE_REVIEW) {
      await deps.platformOutput.sendFileReview(chatId, result.fileReview);
      return;
    }

    if (result.mode === ResultMode.MERGE_RESOLVING) {
      const conflictList = result.conflicts.map(f => `• \`${f}\``).join("\n");
      const dispatcher = new FeishuOutputGateway(deps);
      await dispatcher.dispatch(chatId, {
        ...textNotification(s.mergeResolving(result.conflicts.length, conflictList))
      });
      return;
    }

    if (result.mode === ResultMode.MERGE_CONFLICT) {
      await dispatcher.dispatch(chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "conflict",
            branchName: result.id,
            baseBranch: typeof (result as { baseBranch?: unknown }).baseBranch === "string" ? (result as { baseBranch: string }).baseBranch : "main",
            message: result.message ?? (result.resolverThread ? s.mergeConflictDetected : s.mergeFailed),
            conflicts: result.conflicts,
            resolverThread: result.resolverThread
          }
        }
      });

      // Bind event pipeline for the resolver thread so its agent events are routed to card updates
      if (result.resolverThread) {
        const resolverThreadId = result.resolverThread.threadId;
        const resolverThreadName = result.resolverThread.threadName;
        const projectForMerge = requireBoundProject(deps, chatId);
        if (!result.resolverThread.turnId) {
          throw new Error(`resolver turnId missing for branch=${result.id}`);
        }
        const resolverTurnId = result.resolverThread.turnId;
        const baseCwd = projectForMerge.cwd;
        const resolverCwd = `${baseCwd}--${resolverThreadName}`;

        // NOTE: turn start persistence/snapshot are established by L2 TurnLifecycleService
        deps.platformOutput.setCardThreadName(chatId, resolverTurnId, resolverThreadName, 0);
        requestLog.info({ resolverThreadId, resolverThreadName, resolverTurnId }, "merge-resolver turn started");
      }
      return;
    }

    if (result.mode === ResultMode.MERGE_SUCCESS) {
      await dispatcher.dispatch(chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "success",
            branchName: result.id,
            baseBranch: typeof (result as { baseBranch?: unknown }).baseBranch === "string" ? (result as { baseBranch: string }).baseBranch : "main",
            message: result.message ?? s.mergeDone
          }
        }
      });
      return;
    }

    if (result.mode === ResultMode.THREAD_SYNC_TEXT) {
      await dispatcher.dispatch(chatId, textNotification(result.text));
      return;
    }

    if (result.mode !== ResultMode.TURN) {
      return;
    }

    if (result.duplicate) {
      requestLog.info({ turnId: result.id, dedupHit: true }, "turn start skipped: duplicate callId");
      return;
    }

    if (!preflightThreadId || !preflightThreadName) {
      throw new Error(`preflight thread selection missing for turn ${result.id}`);
    }
    const projectForTurn = requireBoundProject(deps, chatId);
    const threadId = preflightThreadId;
    const threadName = preflightThreadName;

    const turnLog = requestLog.child({ threadId, threadName, turnId: result.id });
    turnLog.info("turn started");

    // NOTE: turn start persistence is handled by L2 TurnLifecycleService after turn/start succeeds;
    // Path B EventPipeline only handles streaming sync/finalization.
    // L1 only sets card UI state below.
    if (threadName !== threadId) {
      deps.platformOutput.setCardThreadName(chatId, result.id, threadName, 0);
    }
    // Set per-turn backend/model info on the card (not shared across turns)
    if (displayBackend || displayModel) {
      deps.platformOutput.setCardBackendInfo(
        chatId, result.id, displayBackend ?? "", displayModel ?? ""
      );
    }
    if (isPlanTurn) {
      deps.platformOutput.setCardTurnMode(chatId, result.id, "plan");
    }
    // Set prompt summary from user's text (header shows what user asked)
    deps.platformOutput.setCardPromptSummary(chatId, result.id, normalizedText);
    turnLog.info("eventPipeline bound");
  } catch (error) {
    const { GUARD, ERR, ORCHESTRATOR_ERROR_MAP } = getFeishuNotifyCatalog(deps.config.locale);
    const chatId = String((data as InboundMessageData).message?.chat_id ?? "");
    const messageId = String((data as InboundMessageData).message?.message_id ?? "");
    const userId = String((data as InboundMessageData).sender?.sender_id?.open_id ?? "");
    const requestLog = log.child({ chatId, userId, messageId, traceId: messageId || undefined });
    if (error instanceof AuthorizationError) {
      requestLog.info({ err: error.message }, "authorization denied");
      if (chatId) {
        const dispatcher = new FeishuOutputGateway(deps);
        try { await dispatcher.dispatch(chatId, textNotification(GUARD.NO_PERMISSION)); } catch (notifyError) {
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
        const dispatcher = new FeishuOutputGateway(deps);
        try { await dispatcher.dispatch(chatId, textNotification(friendly ?? ERR.generic(error.message))); } catch (notifyError) {
          requestLog.warn({ err: notifyError instanceof Error ? notifyError.message : String(notifyError), code: error.code }, "orchestrator error notify failed");
        }
      }
      return;
    }
    const errorMsg = error instanceof Error ? error.message : String(error);
    requestLog.error({ err: errorMsg }, "handler error");
    if (chatId) {
      const dispatcher = new FeishuOutputGateway(deps);
      try { await dispatcher.dispatch(chatId, textNotification(ERR.generic(errorMsg))); } catch (notifyError) {
        requestLog.warn({ err: notifyError instanceof Error ? notifyError.message : String(notifyError) }, "generic error notify failed");
      }
    }
  }
}

export async function handleFeishuMessage(deps: FeishuHandlerDeps, data: Record<string, unknown>): Promise<void> {
  const normalized = feishuInboundAdapter.toInput(data);
  if (!normalized || normalized.kind !== "message") {
    return;
  }
  await feishuInputRouter.route(deps, normalized as PlatformMessageInput);
}
