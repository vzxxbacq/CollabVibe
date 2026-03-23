/**
 * @module src/slack/slack-message-handler
 * @layer Slack (platform-specific)
 *
 * Slack inbound message handler bridging Socket Mode callbacks to core intent dispatch.
 */
import { routeIntent } from "../common/intent-router";
import type { PlatformMessageInput } from "../common/platform-input";
import { createLogger } from "../logging";
import { SlackInboundAdapter } from "./channel/index";
import { isBackendId } from "../../services/index";
import { AuthorizationError } from "../../services/index";
import { OrchestratorError } from "../../services/index";
import type { EffectiveRole, MergeResult } from "../../services/index";
import { ResultMode } from "../common/result";
import type { HandleIntentResult } from "../common/result";
import { dispatchIntent } from "../common/dispatcher";
import { PlatformInputRouter } from "../common/platform-input-router";
import {
  createProject,
  handleAdminIntentOutput,
  handleUserIntentOutput,
  listSkills,
  removeSkill
} from "../common/platform-commands";
import {
  buildSlackHelpPanelPayload,
  sendModelList,
  sendProjectList,
  sendSnapshotList,
  sendThreadNewForm,
  postSlackMessage,
  renderSlackHelpPanel
} from "./shared-handlers";
import { parseSlackCommand, type SlackMergeCommand, type SlackParsedCommand } from "./slack-command-parser";
import { SlackOutputGateway } from "./platform-output-dispatcher";
import { resolveProjectByChatId } from "../common/project-resolution";
import { textNotification } from "../common/output-helpers";
import type { SlackHandlerDeps } from "./types";

const log = createLogger("slack-handler");
const slackInboundAdapter = new SlackInboundAdapter();
const slackInputRouter = new PlatformInputRouter<SlackHandlerDeps>({
  handleMessage: async (deps, input) => handleSlackMessageLegacy(deps, {
    chatId: input.chatId,
    userId: input.userId,
    text: input.text,
    messageTs: input.messageId,
    threadTs: input.threadId,
  })
});

export interface SlackInboundMessage {
  chatId: string;
  userId: string;
  text: string;
  messageTs: string;
  threadTs?: string;
}

function normalizeSlackText(text: string): string {
  return text.replace(/<@[^>]+>/g, "").trim();
}

function isPlanTurnText(text: string): boolean {
  return /^\s*\/plan(?:\s+|$)/.test(text);
}

function normalizeTurnPrompt(text: string): string {
  const match = /^\s*\/plan(?:\s+|$)/.exec(text);
  if (!match) return text.trim();
  return text.slice(match[0].length).trim() || "Please draft a plan for this task.";
}

function dedupKey(input: SlackInboundMessage): string {
  return `${input.chatId}:${input.userId}:${input.messageTs}`;
}

async function dispatchMergeResult(
  deps: SlackHandlerDeps,
  input: SlackInboundMessage,
  branchName: string,
  result: MergeResult
): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  switch (result.kind) {
    case "review":
      await deps.platformOutput.sendFileReview(input.chatId, result.data);
      return;
    case "summary":
      await deps.platformOutput.sendMergeSummary(input.chatId, result.data);
      return;
    case "preview":
      await dispatcher.dispatch(input.chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "preview",
            branchName,
            baseBranch: result.baseBranch,
            message: "Merge preview ready.",
            diffStats: result.diffStats
          }
        }
      });
      return;
    case "conflict":
      await dispatcher.dispatch(input.chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "conflict",
            branchName,
            baseBranch: result.baseBranch,
            message: "Merge conflict detected.",
            conflicts: result.conflicts
          }
        }
      });
      return;
    case "success":
      await dispatcher.dispatch(input.chatId, textNotification(result.message ?? "Merge completed."));
      return;
    case "rejected":
      await dispatcher.dispatch(input.chatId, textNotification(result.message));
      return;
  }
}

async function handleSlackMergeCommand(
  deps: SlackHandlerDeps,
  input: SlackInboundMessage,
  projectId: string,
  command: SlackMergeCommand
): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  const context = { traceId: input.messageTs, userId: input.userId };
  if (!command.branchName) {
    await dispatcher.dispatch(input.chatId, textNotification("Merge command requires a branch name."));
    return;
  }

  if (command.action === "preview") {
    const preview = await deps.api.handleMergePreview({ projectId, branchName: command.branchName, context });
    await dispatchMergeResult(deps, input, command.branchName, preview);
    return;
  }

  if (command.action === "confirm") {
    const result = await deps.api.handleMergeConfirm({ projectId, branchName: command.branchName, actorId: input.userId, context });
    await dispatchMergeResult(deps, input, command.branchName, result);
    return;
  }

  if (command.action === "force") {
    const result = await deps.api.handleMerge({ projectId, branchName: command.branchName, actorId: input.userId, force: true, context });
    await dispatchMergeResult(deps, input, command.branchName, result);
    return;
  }

  if (command.action === "review") {
    const review = await deps.api.startMergeReview({ projectId, branchName: command.branchName, actorId: input.userId, context });
    await dispatchMergeResult(deps, input, command.branchName, review);
    return;
  }

  if (command.action === "accept_all") {
    const result = await deps.api.mergeAcceptAll({ projectId, branchName: command.branchName, actorId: input.userId, context });
    await dispatchMergeResult(deps, input, command.branchName, result);
    return;
  }

  if (command.action === "commit") {
    const result = await deps.api.commitMergeReview({ projectId, branchName: command.branchName, actorId: input.userId, context });
    await dispatchMergeResult(deps, input, command.branchName, result);
    return;
  }

  if (command.action === "cancel") {
    await deps.api.cancelMergeReview({ projectId, branchName: command.branchName, actorId: input.userId, context });
    await dispatcher.dispatch(input.chatId, textNotification(`Merge review cancelled: ${command.branchName}`));
    return;
  }

  if (command.action === "agent") {
    const review = await deps.api.resolveConflictsViaAgent({ projectId, branchName: command.branchName, actorId: input.userId, prompt: command.prompt, context });
    await dispatchMergeResult(deps, input, command.branchName, review);
    return;
  }

  if (command.action === "retry") {
    if (!command.filePath) {
      await dispatcher.dispatch(input.chatId, textNotification("Merge retry requires a file path."));
      return;
    }
    const review = await deps.api.retryMergeFile({ projectId, branchName: command.branchName, filePath: command.filePath, feedback: command.prompt ?? "", actorId: input.userId, context });
    await dispatchMergeResult(deps, input, command.branchName, review);
    return;
  }

  if (!command.decision || !command.filePath) {
    await dispatcher.dispatch(input.chatId, textNotification("Merge decide requires `<branch> <decision> <filePath>`."));
    return;
  }
  const result = await deps.api.mergeDecideFile({ projectId, branchName: command.branchName, filePath: command.filePath, decision: command.decision, actorId: input.userId, context });
  await dispatchMergeResult(deps, input, command.branchName, result);
}

async function handleSlackCommand(
  deps: SlackHandlerDeps,
  input: SlackInboundMessage,
  command: SlackParsedCommand
): Promise<boolean> {
  const dispatcher = new SlackOutputGateway(deps);
  if (command.kind === "reply") {
    if (!command.callId || !command.answer) {
      await dispatcher.dispatch(input.chatId, textNotification("Reply format: `/reply <callId> <answer>`"));
      return true;
    }
    const project = resolveProjectByChatId(deps.api, input.chatId);
    if (!project) {
      await dispatcher.dispatch(input.chatId, textNotification("No active thread. Join or create a thread before replying."));
      return true;
    }
    const active = await deps.api.getUserActiveThread({ projectId: project.id, userId: input.userId });
    if (!active) {
      await dispatcher.dispatch(input.chatId, textNotification("No active thread. Join or create a thread before replying."));
      return true;
    }
    await deps.api.respondUserInput({ projectId: project.id, threadName: active.threadName, callId: command.callId, answers: { default: [command.answer] } });
    await dispatcher.dispatch(input.chatId, textNotification("User input response sent."));
    return true;
  }

  if (command.kind === "merge") {
    const project = resolveProjectByChatId(deps.api, input.chatId);
    if (!project) {
      await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return true;
    }
    await handleSlackMergeCommand(deps, input, project.id, command);
    return true;
  }

  const parsedIntent = command.intent;
  if (parsedIntent.intent === "HELP") {
    const topic = String(parsedIntent.args.topic ?? "");
    if (topic === "backends") {
      const panel = await buildSlackHelpPanelPayload(deps, input.chatId, input.userId, "help_backends");
      if (!panel) {
        await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
        return true;
      }
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
      return true;
    }
    if (topic === "turns") {
      const panel = await buildSlackHelpPanelPayload(deps, input.chatId, input.userId, "help_turns");
      if (!panel) {
        await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
        return true;
      }
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
      return true;
    }
    if (topic === "turn_view") {
      const turnId = String(parsedIntent.args.turnId ?? "");
      if (!turnId) {
        await dispatcher.dispatch(input.chatId, textNotification("Turn view requires a turnId."));
        return true;
      }
      const project = resolveProjectByChatId(deps.api, input.chatId);
      if (!project) {
        await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
        return true;
      }
      const turn = await deps.api.getTurnDetail({ projectId: project.id, turnId });
      await dispatcher.dispatch(input.chatId, {
        ...textNotification([
          `*Turn* \`${turn.record.turnId}\``,
          `Thread: ${turn.record.threadName}`,
          `Status: ${turn.record.status}`,
          turn.detail.promptSummary ? `Prompt: ${turn.detail.promptSummary}` : "",
          turn.detail.message ? `Message:\n${turn.detail.message}` : "",
          turn.record.diffSummary ? `Diff:\n${turn.record.diffSummary}` : ""
        ].filter(Boolean).join("\n"))
      });
      return true;
    }
    const panel = await buildSlackHelpPanelPayload(deps, input.chatId, input.userId, "help_home");
    if (!panel) {
      await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return true;
    }
    await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
    return true;
  }

  if (parsedIntent.intent === "PROJECT_CREATE") {
    const result = await createProject(deps, input.chatId, input.userId, {
      name: String(parsedIntent.args.name ?? ""),
      cwd: String(parsedIntent.args.cwd ?? "")
    });
    await dispatcher.dispatch(input.chatId, {
      ...textNotification(result.success && result.project
        ? `Project created: *${result.project.name}*`
        : result.message)
    });
    return true;
  }

  if (parsedIntent.intent === "PROJECT_LIST") {
    await sendProjectList(deps, input.chatId);
    return true;
  }

  const project = resolveProjectByChatId(deps.api, input.chatId);
  if (!project) {
    await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
    return true;
  }

  if (parsedIntent.intent === "THREAD_NEW") {
    const threadName = String(parsedIntent.args.name ?? "").trim();
    if (!threadName) {
      await sendThreadNewForm(deps, input.chatId, input.userId);
        return true;
      }

    const backendModelRaw = String(parsedIntent.args.backendModel ?? "").trim();
    let backendId = "codex";
    let model = "";
    let profileName: string | undefined;
    let serverCmd: string | undefined;

    if (backendModelRaw) {
      const first = backendModelRaw.indexOf(":");
      const rawBackend = first >= 0 ? backendModelRaw.slice(0, first) : backendModelRaw;
      const afterFirst = first >= 0 ? backendModelRaw.slice(first + 1) : "";
      const second = afterFirst.indexOf(":");
      profileName = second >= 0 ? afterFirst.slice(0, second) : undefined;
      model = second >= 0 ? afterFirst.slice(second + 1) : afterFirst;
      backendId = isBackendId(rawBackend) ? rawBackend : "codex";
      serverCmd = undefined;
    } else {
      const catalog = await deps.api.getBackendCatalog({ projectId: project.id, userId: input.userId });
      backendId = catalog.defaultSelection?.backendId ?? "codex";
      model = catalog.defaultSelection?.model ?? "";
      profileName = catalog.defaultSelection?.profileName;
    }

    const created = await deps.api.createThread({
      projectId: project.id,
      userId: input.userId,
      actorId: input.userId,
      threadName,
      backendId: isBackendId(backendId) ? backendId : "codex",
      model: model || "gpt-5-codex",
      profileName,
      serverCmd
    });
    await deps.platformOutput.sendThreadOperation(input.chatId, {
      kind: "thread_operation",
      action: "created",
      thread: { threadId: created.threadId, threadName: created.threadName }
    });
    return true;
  }

  if (parsedIntent.intent === "THREAD_LIST") {
    const threads = await deps.api.listThreads({ projectId: project.id, actorId: input.userId });
    const activeBinding = await deps.api.getUserActiveThread({ projectId: project.id, userId: input.userId });
    await deps.platformOutput.sendThreadOperation(input.chatId, {
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
    });
    return true;
  }

  if (parsedIntent.intent === "THREAD_SWITCH") {
    const action = String(parsedIntent.args.action ?? "");
    if (action === "leave") {
      await deps.api.leaveThread({ projectId: project.id, userId: input.userId, actorId: input.userId });
      await deps.platformOutput.sendThreadOperation(input.chatId, { kind: "thread_operation", action: "left" });
      return true;
    }
    const threadName = String(parsedIntent.args.name ?? "");
    const joined = await deps.api.joinThread({ projectId: project.id, userId: input.userId, actorId: input.userId, threadName });
    await deps.platformOutput.sendThreadOperation(input.chatId, {
      kind: "thread_operation",
      action: action === "resume" ? "resumed" : "joined",
      thread: joined
    });
    return true;
  }

  if (parsedIntent.intent === "MODEL_LIST") {
    await sendModelList(deps, input.chatId, input.userId);
    return true;
  }

  if (parsedIntent.intent === "SNAPSHOT_LIST") {
    if (String(parsedIntent.args.action ?? "") === "jump") {
      const turnId = String(parsedIntent.args.turnId ?? "");
      const { snapshot, contextReset } = await deps.api.jumpToSnapshot({ projectId: project.id, targetTurnId: turnId, userId: input.userId });
      await deps.platformOutput.sendSnapshotOperation(input.chatId, {
        kind: "snapshot_operation",
        action: "jumped",
        threadId: snapshot.threadId,
        target: {
          turnId: snapshot.turnId,
          turnIndex: snapshot.turnIndex,
          agentSummary: snapshot.agentSummary,
          createdAt: snapshot.createdAt,
          isCurrent: true
        },
        contextReset
      }, input.userId);
      return true;
    }
    await sendSnapshotList(deps, input.chatId, input.userId);
    return true;
  }

  if (["USER_LIST", "USER_ROLE", "USER_ADD", "USER_REMOVE"].includes(parsedIntent.intent)) {
    await dispatcher.dispatch(input.chatId, handleUserIntentOutput(deps, input.chatId, input.userId, parsedIntent));
    return true;
  }

  if (["ADMIN_ADD", "ADMIN_REMOVE", "ADMIN_LIST"].includes(parsedIntent.intent)) {
    await dispatcher.dispatch(input.chatId, handleAdminIntentOutput(deps, parsedIntent));
    return true;
  }

  if (parsedIntent.intent === "SKILL_LIST" || parsedIntent.intent === "SKILL_ADMIN") {
    const projectSkills = await listSkills(deps);
    await deps.platformOutput.sendSkillOperation(input.chatId, {
      kind: "skill_operation",
      action: "form",
      skills: projectSkills.map((skill) => ({
        name: skill.name ?? "unknown",
        description: skill.description ?? "",
        installed: !!skill.enabled
      }))
    });
    return true;
  }

  if (parsedIntent.intent === "SKILL_INSTALL") {
    const source = String(parsedIntent.args.source ?? "").trim();
    if (!source) {
      await dispatcher.dispatch(input.chatId, textNotification("Skill install requires a source."));
      return true;
    }
    try {
      const installed = await deps.api.installSkill({ source, projectId: project.id, userId: input.userId, actorId: input.userId });
      await deps.platformOutput.sendSkillOperation(input.chatId, {
        kind: "skill_operation",
        action: "installed",
        skill: { name: installed.name ?? source, description: installed.description ?? "", installed: true }
      });
    } catch (error) {
      await deps.platformOutput.sendSkillOperation(input.chatId, {
        kind: "skill_operation",
        action: "error",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return true;
  }

  if (parsedIntent.intent === "SKILL_REMOVE") {
    const name = String(parsedIntent.args.name ?? "").trim();
    if (!name) {
      await dispatcher.dispatch(input.chatId, textNotification("Skill remove requires a skill name."));
      return true;
    }
    const removed = project.id
      ? await deps.api.unbindSkillFromProject({ projectId: project.id, skillName: name, actorId: input.userId })
      : await removeSkill(deps, name);
    if (removed) {
      await deps.platformOutput.sendSkillOperation(input.chatId, {
        kind: "skill_operation",
        action: "removed",
        skill: { name, description: "", installed: false }
      });
    } else {
      await dispatcher.dispatch(input.chatId, textNotification(`Skill not found: ${name}`));
    }
    return true;
  }

  return false;
}

async function handleSlackMessageLegacy(deps: SlackHandlerDeps, input: SlackInboundMessage): Promise<void> {
  const eventKey = dedupKey(input);
  if (deps.recentEventIds.has(eventKey)) {
    return;
  }
  deps.recentEventIds.add(eventKey);
  setTimeout(() => deps.recentEventIds.delete(eventKey), deps.eventDedupTtlMs);

  const requestLog = log.child({
    chatId: input.chatId,
    userId: input.userId,
    messageTs: input.messageTs,
    threadTs: input.threadTs
  });

  try {
    const dispatcher = new SlackOutputGateway(deps);
    const text = normalizeSlackText(input.text);
    requestLog.info({ text: text.slice(0, 80) }, "inbound slack message");

    const localCommand = parseSlackCommand(text);
    if (localCommand) {
      const handled = await handleSlackCommand(deps, input, localCommand);
      if (handled) {
        return;
      }
    }

    if (!text) {
      const dispatcher = new SlackOutputGateway(deps);
      const panel = await buildSlackHelpPanelPayload(deps, input.chatId, input.userId, "help_home");
      if (!panel) {
        await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
        return;
      }
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
      return;
    }

    const project = resolveProjectByChatId(deps.api, input.chatId);
    if (!project) {
      await dispatcher.dispatch(input.chatId, textNotification("This Slack channel is not bound to a project yet."));
      return;
    }
    if (project.status === "disabled") {
      await dispatcher.dispatch(input.chatId, {
        kind: "notification",
        data: {
          kind: "notification",
          threadId: "",
          category: "warning",
          title: "Project disabled",
          detail: `Project ${project.name} is disabled.`
        }
      });
      return;
    }

    const role = deps.api.resolveRole({ userId: input.userId, projectId: project.id }) as EffectiveRole | null;
    if (!role) {
      throw new Error(`role resolution failed for userId=${input.userId} projectId=${project.id}`);
    }
    const traceId = input.messageTs;
    const message = {
      // UnifiedChannel does not include Slack yet; routing logic only depends on `type`.
      channel: "unknown" as const,
      eventId: input.messageTs,
      traceId,
      chatId: input.chatId,
      userId: input.userId,
      timestamp: Date.now(),
      raw: input,
      type: "text" as const,
      text,
      mentions: []
    };
    const intent = routeIntent(message);

    let preflightThreadId: string | null = null;
    let preflightThreadName: string | null = null;
    let displayBackend: string | undefined;
    let displayModel: string | undefined;
    if (intent.intent === "TURN_START") {
      const selected = await deps.api.getUserActiveThread({ projectId: project.id, userId: input.userId });
      if (selected) {
        preflightThreadId = selected.threadId;
        preflightThreadName = selected.threadName;

        if (deps.api.isPendingApproval({ projectId: project.id, threadName: selected.threadName })) {
          await dispatcher.dispatch(input.chatId, textNotification(`Thread *${selected.threadName}* is waiting for approval.`));
          return;
        }


        displayBackend = selected.backend.backendId;
        displayModel = selected.backend.model;
      }
    }

    const dispatch = await dispatchIntent(deps, {
      projectId: project.id,
      chatId: input.chatId,
      userId: input.userId,
      text,
      traceId,
      platform: "slack",
      messageId: input.messageTs,
      messageType: "text",
      role
    }, intent);

    if (!dispatch.routed) {
      await dispatcher.dispatch(input.chatId, textNotification(`Intent ${dispatch.intent.intent} is not available for plain text here.`));
      return;
    }

    const result = dispatch.result;
    if (result.mode === ResultMode.THREAD_NEW_FORM) {
      await sendThreadNewForm(deps, input.chatId, input.userId);
      return;
    }
    if (result.mode === ResultMode.THREAD_CREATED) {
      await deps.platformOutput.sendThreadOperation(input.chatId, {
        kind: "thread_operation",
        action: "created",
        thread: { threadId: result.id, threadName: result.threadName }
      });
      return;
    }
    if (result.mode === ResultMode.THREAD_JOINED || result.mode === ResultMode.THREAD_RESUMED) {
      await deps.platformOutput.sendThreadOperation(input.chatId, {
        kind: "thread_operation",
        action: result.mode === ResultMode.THREAD_RESUMED ? "resumed" : "joined",
        thread: { threadId: result.id, threadName: result.threadName }
      });
      return;
    }
    if (result.mode === ResultMode.THREAD_LIST) {
      const threads = await deps.api.listThreads({ projectId: project.id, actorId: input.userId });
      const activeBinding = await deps.api.getUserActiveThread({ projectId: project.id, userId: input.userId });
      await deps.platformOutput.sendThreadOperation(input.chatId, {
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
      });
      return;
    }
    if (result.mode === ResultMode.MERGE_PREVIEW) {
      const baseBranch = typeof (result as { baseBranch?: unknown }).baseBranch === "string"
        ? (result as { baseBranch: string }).baseBranch
        : "main";
      await dispatcher.dispatch(input.chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "preview",
            branchName: result.id,
            baseBranch,
            message: "Merge preview ready.",
            diffStats: result.diffStats
          }
        }
      });
      return;
    }
    if (result.mode === ResultMode.MERGE_CONFLICT) {
      const baseBranch = typeof (result as { baseBranch?: unknown }).baseBranch === "string"
        ? (result as { baseBranch: string }).baseBranch
        : "main";
      await dispatcher.dispatch(input.chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "conflict",
            branchName: result.id,
            baseBranch,
            message: result.message ?? "Merge conflict detected.",
            conflicts: result.conflicts,
            resolverThread: result.resolverThread
          }
        }
      });
      return;
    }
    if (result.mode === ResultMode.MERGE_SUCCESS) {
      const baseBranch = typeof (result as { baseBranch?: unknown }).baseBranch === "string"
        ? (result as { baseBranch: string }).baseBranch
        : "main";
      await dispatcher.dispatch(input.chatId, {
        kind: "merge_event",
        data: {
          action: "resolver_complete",
          operation: {
            kind: "merge_operation",
            action: "success",
            branchName: result.id,
            baseBranch,
            message: result.message ?? "Merge completed."
          }
        }
      });
      return;
    }
    if (result.mode === ResultMode.MERGE_FILE_REVIEW) {
      await deps.platformOutput.sendFileReview(input.chatId, result.fileReview);
      return;
    }
    if (result.mode === ResultMode.MERGE_SUMMARY) {
      await deps.platformOutput.sendMergeSummary(input.chatId, result.mergeSummary);
      return;
    }
    if (result.mode === ResultMode.MERGE_RESOLVING) {
      await dispatcher.dispatch(input.chatId, textNotification(`Resolving ${result.conflicts.length} merge conflict(s) via agent.`));
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
    const threadId = preflightThreadId;
    const threadName = preflightThreadName;
    const normalizedText = normalizeTurnPrompt(text);

    // NOTE: turn start persistence is handled by L2 TurnLifecycleService after turn/start succeeds;
    // Path B EventPipeline only handles streaming sync/finalization.
    requestLog.info({ threadId, threadName, turnId: result.id }, "slack turn pipeline bound");
  } catch (error) {
    const dispatcher = new SlackOutputGateway(deps);
    if (error instanceof AuthorizationError) {
      await dispatcher.dispatch(input.chatId, textNotification("You do not have permission for that action."));
      return;
    }
    if (error instanceof OrchestratorError) {
      await dispatcher.dispatch(input.chatId, textNotification(error.message));
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    requestLog.error({ err: message }, "slack message handler failed");
    await dispatcher.dispatch(input.chatId, textNotification(`Slack handler error: ${message}`));
  }
}

export async function handleSlackMessage(deps: SlackHandlerDeps, input: SlackInboundMessage): Promise<void> {
  const normalized = slackInboundAdapter.toInput(input);
  if (!normalized || normalized.kind !== "message") {
    return;
  }
  await slackInputRouter.route(deps, normalized as PlatformMessageInput);
}
