/**
 * @module src/slack/slack-message-handler
 * @layer Slack (platform-specific)
 *
 * Slack inbound message handler bridging Socket Mode callbacks to core intent dispatch.
 */
import { routeIntent } from "../../services/contracts/im/intent-router";
import type { PlatformMessageInput } from "../../services/contracts/im/platform-input";
import { createLogger } from "../../packages/logger/src/index";
import { SlackInboundAdapter } from "./channel/index";
import { isBackendId } from "../../services/orchestrator/src/index";
import { AuthorizationError } from "../../services/orchestrator/src/iam/index";
import { OrchestratorError } from "../../services/orchestrator/src/index";
import { ResultMode } from "../../services/orchestrator/src/index";
import { dispatchIntent } from "../../services/orchestrator/src/intent/dispatcher";
import { PlatformInputRouter } from "../../services/orchestrator/src/commands/platform-input-router";
import {
  createProject,
  handleAdminIntentOutput,
  handleUserIntentOutput,
  listSkills,
  removeSkill
} from "../../services/orchestrator/src/commands/platform-commands";
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

async function handleSlackMergeCommand(
  deps: SlackHandlerDeps,
  input: SlackInboundMessage,
  projectId: string,
  command: SlackMergeCommand
): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  const context = { traceId: input.messageTs, userId: input.userId };
  if (!command.branchName) {
    await dispatcher.dispatch(input.chatId, { kind: "text", text: "Merge command requires a branch name." });
    return;
  }

  if (command.action === "preview") {
    const preview = await deps.orchestrator.handleMergePreview(input.chatId, command.branchName, context);
    await deps.platformOutput.sendMergeOperation(input.chatId, {
      kind: "thread_merge",
      action: "preview",
      branchName: command.branchName,
      baseBranch: preview.baseBranch,
      message: "Merge preview ready.",
      diffStats: preview.diffStats
    });
    return;
  }

  if (command.action === "confirm") {
    const result = await deps.orchestrator.handleMergeConfirm(input.chatId, command.branchName, undefined, context);
    await dispatcher.dispatch(input.chatId, { kind: "text", text: result.message });
    return;
  }

  if (command.action === "force") {
    const result = await deps.orchestrator.handleMerge(projectId, input.chatId, command.branchName, { force: true }, context);
    await dispatcher.dispatch(input.chatId, { kind: "text", text: result.message });
    return;
  }

  if (command.action === "review") {
    const review = await deps.orchestrator.startMergeReview(input.chatId, command.branchName, context);
    await deps.platformOutput.sendFileReview(input.chatId, review);
    return;
  }

  if (command.action === "accept_all") {
    const result = await deps.orchestrator.mergeAcceptAll(input.chatId, command.branchName, context);
    if (result.kind === "file_merge_review") {
      await deps.platformOutput.sendFileReview(input.chatId, result);
    } else {
      await deps.platformOutput.sendMergeSummary(input.chatId, result);
    }
    return;
  }

  if (command.action === "commit") {
    const result = await deps.orchestrator.commitMergeReview(input.chatId, command.branchName, context);
    await dispatcher.dispatch(input.chatId, { kind: "text", text: result.message });
    return;
  }

  if (command.action === "cancel") {
    await deps.orchestrator.cancelMergeReview(input.chatId, command.branchName, context);
    await deps.platformOutput.sendMergeOperation(input.chatId, {
      kind: "thread_merge",
      action: "rejected",
      branchName: command.branchName,
      baseBranch: "main",
      message: `Merge review cancelled: ${command.branchName}`
    });
    return;
  }

  if (command.action === "agent") {
    const review = await deps.orchestrator.resolveConflictsViaAgent(input.chatId, command.branchName, command.prompt, context);
    await deps.platformOutput.sendFileReview(input.chatId, review);
    return;
  }

  if (command.action === "retry") {
    if (!command.filePath) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "Merge retry requires a file path." });
      return;
    }
    const review = await deps.orchestrator.retryMergeFile(input.chatId, command.branchName, command.filePath, command.prompt ?? "", context);
    await deps.platformOutput.sendFileReview(input.chatId, review);
    return;
  }

  if (!command.decision || !command.filePath) {
    await dispatcher.dispatch(input.chatId, { kind: "text", text: "Merge decide requires `<branch> <decision> <filePath>`." });
    return;
  }
  const result = await deps.orchestrator.mergeDecideFile(input.chatId, command.branchName, command.filePath, command.decision, context);
  if (result.kind === "file_merge_review") {
    await deps.platformOutput.sendFileReview(input.chatId, result);
  } else {
    await deps.platformOutput.sendMergeSummary(input.chatId, result);
  }
}

async function handleSlackCommand(
  deps: SlackHandlerDeps,
  input: SlackInboundMessage,
  command: SlackParsedCommand
): Promise<boolean> {
  const dispatcher = new SlackOutputGateway(deps);
  if (command.kind === "reply") {
    if (!command.callId || !command.answer) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "Reply format: `/reply <callId> <answer>`" });
      return true;
    }
    const active = await deps.orchestrator.getUserActiveThread(input.chatId, input.userId);
    if (!active) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "No active thread. Join or create a thread before replying." });
      return true;
    }
    await deps.orchestrator.respondUserInput(input.chatId, active.threadName, command.callId, { default: [command.answer] });
    await dispatcher.dispatch(input.chatId, { kind: "text", text: "User input response sent." });
    return true;
  }

  if (command.kind === "merge") {
    const project = deps.findProjectByChatId(input.chatId);
    if (!project) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
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
        await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
        return true;
      }
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
      return true;
    }
    if (topic === "turns") {
      const panel = await buildSlackHelpPanelPayload(deps, input.chatId, input.userId, "help_turns");
      if (!panel) {
        await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
        return true;
      }
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
      return true;
    }
    if (topic === "turn_view") {
      const turnId = String(parsedIntent.args.turnId ?? "");
      if (!turnId) {
        await dispatcher.dispatch(input.chatId, { kind: "text", text: "Turn view requires a turnId." });
        return true;
      }
      const turn = await deps.orchestrator.getTurnDetail(input.chatId, turnId);
      await dispatcher.dispatch(input.chatId, {
        kind: "text",
        text: [
          `*Turn* \`${turn.record.turnId}\``,
          `Thread: ${turn.record.threadName}`,
          `Status: ${turn.record.status}`,
          turn.detail.promptSummary ? `Prompt: ${turn.detail.promptSummary}` : "",
          turn.detail.message ? `Message:\n${turn.detail.message}` : "",
          turn.record.diffSummary ? `Diff:\n${turn.record.diffSummary}` : ""
        ].filter(Boolean).join("\n")
      });
      return true;
    }
    const panel = await buildSlackHelpPanelPayload(deps, input.chatId, input.userId, "help_home");
    if (!panel) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
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
      kind: "text",
      text: result.success && result.project
        ? `Project created: *${result.project.name}*`
        : result.message
    });
    return true;
  }

  if (parsedIntent.intent === "PROJECT_LIST") {
    await sendProjectList(deps, input.chatId);
    return true;
  }

  const project = deps.findProjectByChatId(input.chatId);
  if (!project) {
    await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
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
      const resolved = await deps.orchestrator.resolveBackend(backendId);
      serverCmd = resolved?.serverCmd;
    } else {
      const session = await deps.orchestrator.resolveSession(input.chatId);
      backendId = session.backend.backendId;
      model = session.backend.model;
    }

    const created = await deps.orchestrator.createThread(project.id, input.chatId, input.userId, threadName, {
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
    const threads = await deps.orchestrator.handleThreadListEntries(input.chatId);
    const activeBinding = await deps.orchestrator.getUserActiveThread(input.chatId, input.userId);
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
      await deps.orchestrator.handleThreadLeave(input.chatId, input.userId);
      await deps.platformOutput.sendThreadOperation(input.chatId, { kind: "thread_operation", action: "left" });
      return true;
    }
    const threadName = String(parsedIntent.args.name ?? "");
    const joined = await deps.orchestrator.handleThreadJoin(input.chatId, input.userId, threadName);
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
      const { snapshot, contextReset } = await deps.orchestrator.jumpToSnapshot(input.chatId, turnId, input.userId);
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
        name: skill.name ?? skill.pluginName ?? "unknown",
        description: skill.description ?? "",
        installed: !!skill.enabled
      }))
    });
    return true;
  }

  if (parsedIntent.intent === "SKILL_INSTALL") {
    const source = String(parsedIntent.args.source ?? "").trim();
    if (!source) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "Skill install requires a source." });
      return true;
    }
    try {
      const installed = await deps.pluginService.install(source, project.id, input.userId);
      await deps.platformOutput.sendSkillOperation(input.chatId, {
        kind: "skill_operation",
        action: "installed",
        skill: { name: installed.name, description: installed.description, installed: true }
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
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "Skill remove requires a skill name." });
      return true;
    }
    const removed = project.id
      ? await deps.pluginService.unbindFromProject?.(project.id, name)
      : await removeSkill(deps, name);
    if (removed) {
      await deps.platformOutput.sendSkillOperation(input.chatId, {
        kind: "skill_operation",
        action: "removed",
        skill: { name, description: "", installed: false }
      });
    } else {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: `Skill not found: ${name}` });
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
        await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
        return;
      }
      await dispatcher.dispatch(input.chatId, { kind: "help_panel", panel });
      return;
    }

    const project = deps.findProjectByChatId(input.chatId);
    if (!project) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "This Slack channel is not bound to a project yet." });
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

    const role = deps.roleResolver.resolve(input.userId, project.id, { autoRegister: true });
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
      const selected = await deps.orchestrator.getUserActiveThread(input.chatId, input.userId);
      if (selected) {
        preflightThreadId = selected.threadId;
        preflightThreadName = selected.threadName;

        if (deps.orchestrator.isPendingApproval(input.chatId, selected.threadName)) {
          await dispatcher.dispatch(input.chatId, { kind: "text", text: `Thread *${selected.threadName}* is waiting for approval.` });
          return;
        }

        if (deps.orchestrator.getConversationState(input.chatId, selected.threadName) === "RUNNING") {
          await dispatcher.dispatch(input.chatId, { kind: "text", text: `Thread *${selected.threadName}* is already running.` });
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
      messageType: "text",
      role
    }, intent);

    if (!dispatch.routed) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: `Intent ${dispatch.intent.intent} is not available for plain text here.` });
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
      const threads = await deps.orchestrator.handleThreadListEntries(input.chatId);
      const activeBinding = await deps.orchestrator.getUserActiveThread(input.chatId, input.userId);
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
      await deps.platformOutput.sendMergeOperation(input.chatId, {
        kind: "thread_merge",
        action: "preview",
        branchName: result.id,
        baseBranch,
        message: "Merge preview ready.",
        diffStats: result.diffStats
      });
      return;
    }
    if (result.mode === ResultMode.MERGE_CONFLICT) {
      const baseBranch = typeof (result as { baseBranch?: unknown }).baseBranch === "string"
        ? (result as { baseBranch: string }).baseBranch
        : "main";
      await deps.platformOutput.sendMergeOperation(input.chatId, {
        kind: "thread_merge",
        action: "conflict",
        branchName: result.id,
        baseBranch,
        message: result.message ?? "Merge conflict detected.",
        conflicts: result.conflicts,
        resolverThread: result.resolverThread
      });
      return;
    }
    if (result.mode === ResultMode.MERGE_SUCCESS) {
      const baseBranch = typeof (result as { baseBranch?: unknown }).baseBranch === "string"
        ? (result as { baseBranch: string }).baseBranch
        : "main";
      await deps.platformOutput.sendMergeOperation(input.chatId, {
        kind: "thread_merge",
        action: "success",
        branchName: result.id,
        baseBranch,
        message: result.message ?? "Merge completed."
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
      await dispatcher.dispatch(input.chatId, { kind: "text", text: `Resolving ${result.conflicts.length} merge conflict(s) via agent.` });
      return;
    }
    if (result.mode !== ResultMode.TURN) {
      return;
    }

    if (!preflightThreadId || !preflightThreadName) {
      throw new Error(`preflight thread selection missing for turn ${result.id}`);
    }
    const threadId = preflightThreadId;
    const threadName = preflightThreadName;
    const normalizedText = normalizeTurnPrompt(text);
    const turnCwd = threadName === threadId ? project.cwd : `${project.cwd}--${threadName}`;

    await deps.orchestrator.recordTurnStart(
      project.id,
      input.chatId,
      threadName,
      threadId,
      result.id,
      turnCwd,
      input.userId,
      traceId
    );
    await deps.orchestrator.updateTurnMetadata(input.chatId, result.id, {
      promptSummary: normalizedText,
      backendName: displayBackend,
      modelName: displayModel,
      turnMode: isPlanTurnText(text) ? "plan" : undefined
    });
    requestLog.info({ threadId, threadName, turnId: result.id }, "slack turn pipeline bound");
  } catch (error) {
    const dispatcher = new SlackOutputGateway(deps);
    if (error instanceof AuthorizationError) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: "You do not have permission for that action." });
      return;
    }
    if (error instanceof OrchestratorError) {
      await dispatcher.dispatch(input.chatId, { kind: "text", text: error.message });
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    requestLog.error({ err: message }, "slack message handler failed");
    await dispatcher.dispatch(input.chatId, { kind: "text", text: `Slack handler error: ${message}` });
  }
}

export async function handleSlackMessage(deps: SlackHandlerDeps, input: SlackInboundMessage): Promise<void> {
  const normalized = slackInboundAdapter.toInput(input);
  if (!normalized || normalized.kind !== "message") {
    return;
  }
  await slackInputRouter.route(deps, normalized as PlatformMessageInput);
}
