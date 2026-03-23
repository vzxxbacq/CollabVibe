/**
 * @module src/slack/shared-handlers
 * @layer Slack (platform-specific)
 *
 * Slack-specific rendering wrappers for shared business logic.
 */
import {
  actions,
  context,
  divider,
  header,
  section
} from "./channel/slack-block-builder";
import { SlackOutputGateway } from "./platform-output-dispatcher";
import {
  listProjects,
  listSnapshots as coreListSnapshots,
  resolveModelList,
  resolveThreadNewFormData
} from "../common/platform-commands";
import { resolveProjectByChatId } from "../common/project-resolution";
import { textNotification } from "../common/output-helpers";
import type { SlackHandlerDeps } from "./types";

export interface SlackHelpPanelPayload {
  blocks: unknown[];
  text: string;
  messageTs?: string;
}

export async function postSlackMessage(deps: SlackHandlerDeps, chatId: string, text: string): Promise<void> {
  await deps.slackMessageClient.postMessage({
    channel: chatId,
    blocks: [section(text)],
    text
  });
}

type SlackHelpPanel =
  | "help_home"
  | "help_threads"
  | "help_history"
  | "help_skills"
  | "help_backends"
  | "help_turns";

function navButton(text: string, actionId: SlackHelpPanel | "help_thread_new") {
  return {
    text,
    actionId: `codex_${actionId}`,
    value: JSON.stringify({ action: actionId })
  } as const;
}

export async function renderSlackHelpPanel(
  deps: SlackHandlerDeps,
  chatId: string,
  userId: string,
  panel: SlackHelpPanel,
  messageTs?: string
): Promise<void> {
  const payload = await buildSlackHelpPanelPayload(deps, chatId, userId, panel, messageTs);
  if (!payload) {
    await postSlackMessage(deps, chatId, "This Slack channel is not bound to a project yet.");
    return;
  }
  if (payload.messageTs) {
    await deps.slackMessageClient.updateMessage({
      channel: chatId,
      ts: payload.messageTs,
      blocks: payload.blocks as Parameters<typeof deps.slackMessageClient.updateMessage>[0]["blocks"],
      text: payload.text
    });
    return;
  }

  await deps.slackMessageClient.postMessage({
    channel: chatId,
    blocks: payload.blocks as Parameters<typeof deps.slackMessageClient.postMessage>[0]["blocks"],
    text: payload.text
  });
}

export async function buildSlackHelpPanelPayload(
  deps: SlackHandlerDeps,
  chatId: string,
  userId: string,
  panel: SlackHelpPanel,
  messageTs?: string
): Promise<SlackHelpPanelPayload | null> {
  const project = resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    return null;
  }

  const activeThread = project ? await deps.api.getUserActiveThread({ projectId: project.id, userId }) : null;
  const currentThread = activeThread?.threadName ?? "main";
  const blocks = panel === "help_threads"
    ? await buildThreadPanel(deps, chatId, userId, currentThread)
    : panel === "help_history"
      ? await buildHistoryPanel(deps, chatId, userId, currentThread)
      : panel === "help_skills"
        ? await buildSkillsPanel(deps)
        : panel === "help_backends"
          ? await buildBackendsPanel(deps)
          : panel === "help_turns"
            ? await buildTurnsPanel(deps, chatId)
            : buildHomePanel(project.name, currentThread);

  const text = `Help panel · ${project.name}`;
  return { blocks, text, messageTs };
}

function buildHomePanel(projectName: string, currentThread: string) {
  return [
    header(`${projectName} Help`),
    section([
      `Current thread: *${currentThread}*`,
      "Slack has no native mention-to-card surface, so the help panel is rendered as an updatable Block Kit message.",
      "Use natural language when mentioning the bot. Use the buttons below for navigable operational panels."
    ].join("\n")),
    context("Mapped from Feishu card flow: one message acts as the panel shell, block actions switch subpanels in place."),
    divider(),
    actions("help_home_primary", [
      navButton("Threads", "help_threads"),
      navButton("History", "help_history"),
      navButton("Turns", "help_turns"),
      navButton("Skills", "help_skills"),
      navButton("Backends", "help_backends")
    ])
  ];
}

async function buildThreadPanel(
  deps: SlackHandlerDeps,
  chatId: string,
  userId: string,
  currentThread: string
) {
  const project = resolveProjectByChatId(deps.api, chatId);
  const threads = await deps.api.listThreads({ projectId: project!.id, actorId: userId });
  const activeBinding = await deps.api.getUserActiveThread({ projectId: project!.id, userId });
  const lines = threads.length > 0
    ? threads.map((thread) => {
      const active = activeBinding?.threadId === thread.threadId ? " <- active" : "";
      const model = thread.model ? ` · ${thread.model}` : "";
      return `• *${thread.threadName}*${active}\n  ${thread.backendId}${model}`;
    }).join("\n")
    : "_No threads yet._";

  return [
    header("Thread Management"),
    section(`Current thread: *${currentThread}*\n${lines}`),
    context("Interactive mapping: switch/create still follows the command path, while the help panel acts as the entry shell."),
    divider(),
    actions("help_threads_actions", [
      navButton("Create Thread", "help_thread_new"),
      navButton("Back", "help_home")
    ])
  ];
}

async function buildHistoryPanel(
  deps: SlackHandlerDeps,
  chatId: string,
  userId: string,
  currentThread: string
) {
  const project = resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    return [
      header("Snapshot History"),
      section("_This Slack channel is not bound to a project yet._"),
      divider(),
      actions("help_history_actions", [navButton("Back", "help_home")])
    ];
  }
  const { snapshots, hasBinding, threadName } = await coreListSnapshots(deps, project.id, userId);
  const targetThread = hasBinding ? threadName : currentThread;
  const lines = snapshots.length > 0
    ? snapshots.slice(-8).reverse().map((snapshot) => {
      const files = snapshot.filesChanged?.length ? ` · ${snapshot.filesChanged.length} file(s)` : "";
      const summary = snapshot.agentSummary ? `\n  ${snapshot.agentSummary}` : "";
      return `• #${snapshot.turnIndex} \`${snapshot.turnId.slice(0, 8)}\`${files}\n  ${snapshot.createdAt}${summary}`;
    }).join("\n")
    : "_No snapshots yet._";

  return [
    header("Snapshot History"),
    section(`Thread: *${targetThread}*\n${lines}`),
    context("Jump remains command-driven on Slack: `/snapshot jump <turnId>`. The panel is discovery and navigation, not an alternate persistence path."),
    divider(),
    actions("help_history_actions", [navButton("Back", "help_home")])
  ];
}

async function buildSkillsPanel(deps: SlackHandlerDeps) {
  const skills = await deps.api.listSkills();
  const lines = skills.length > 0
    ? skills.slice(0, 12).map((skill) =>
      `• *${skill.name ?? "unknown"}*${skill.enabled ? " (installed)" : ""}\n  ${skill.description ?? "No description"}`
    ).join("\n")
    : "_No installable skills available._";

  return [
    header("Skill Management"),
    section(lines),
    context("Slack mapping keeps install/remove on the command path: `/skill install <source>` and `/skill remove <name>`."),
    divider(),
    actions("help_skills_actions", [navButton("Back", "help_home")])
  ];
}

async function buildBackendsPanel(deps: SlackHandlerDeps) {
  const backends = await deps.api.listAvailableBackends();
  const lines = backends.length > 0
    ? backends.map((backend) => {
      const models = backend.models?.length ? backend.models.join(", ") : "no models";
      return `• *${backend.name}*\n  ${models}`;
    }).join("\n")
    : "_No backends available._";

  return [
    header("Backend Overview"),
    section(lines),
    context("Thread creation reads backend identity from thread records. This panel is read-only discovery for Slack."),
    divider(),
    actions("help_backends_actions", [navButton("Back", "help_home")])
  ];
}

async function buildTurnsPanel(deps: SlackHandlerDeps, chatId: string) {
  const project = resolveProjectByChatId(deps.api, chatId);
  const turns = project ? await deps.api.listTurns({ projectId: project.id, limit: 10 }) : [];
  const lines = turns.length > 0
    ? turns.map((turn) =>
      `• \`${turn.turnId.slice(0, 8)}\` · *${turn.threadName}* · ${turn.status}${turn.promptSummary ? `\n  ${turn.promptSummary}` : ""}`
    ).join("\n")
    : "_No turns recorded yet._";

  return [
    header("Turn History"),
    section(lines),
    context("Detailed turn inspection remains command-driven: `/help turns` or `/help turn_view <turnId>`."),
    divider(),
    actions("help_turns_actions", [navButton("Back", "help_home")])
  ];
}

export async function sendProjectList(deps: SlackHandlerDeps, chatId: string): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  const projects = listProjects(deps);
  if (projects.length === 0) {
    await dispatcher.dispatch(chatId, textNotification("No projects are bound yet."));
    return;
  }
  const lines = projects.map((project) => `• *${project.name}* \`${project.id}\`  ${project.cwd}`);
  await dispatcher.dispatch(chatId, textNotification(lines.join("\n")));
}

export async function sendSnapshotList(deps: SlackHandlerDeps, chatId: string, userId: string): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  const project = resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    await dispatcher.dispatch(chatId, {
      ...textNotification("This Slack channel is not bound to a project yet.")
    });
    return;
  }
  const { snapshots, threadId, threadName, hasBinding } = await coreListSnapshots(deps, project.id, userId);
  if (snapshots.length === 0) {
    await dispatcher.dispatch(chatId, {
      ...textNotification(hasBinding ? `No snapshots yet for *${threadName}*.` : "No snapshots yet on the main thread.")
    });
    return;
  }
  const latestIndex = snapshots[snapshots.length - 1]!.turnIndex;
  await dispatcher.dispatch(chatId, {
    kind: "snapshot_operation",
    data: {
      kind: "snapshot_operation",
      action: "listed",
      threadId,
      threadName,
      snapshots: snapshots.map((snapshot) => ({
        turnId: snapshot.turnId,
        turnIndex: snapshot.turnIndex,
        agentSummary: snapshot.agentSummary,
        filesChanged: snapshot.filesChanged,
        createdAt: snapshot.createdAt,
        isCurrent: snapshot.turnIndex === latestIndex
      }))
    },
    userId
  });
}

export async function sendModelList(deps: SlackHandlerDeps, chatId: string, userId: string): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  const project = resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    throw new Error("This Slack channel is not bound to a project yet.");
  }
  const { currentModel, availableModels, threadName } = await resolveModelList(deps, project.id, userId);
  await dispatcher.dispatch(chatId, {
    kind: "config_operation",
    data: {
      kind: "config_operation",
      action: "model_list",
      currentModel,
      availableModels,
      threadName
    },
    userId
  });
}

export async function sendThreadNewForm(deps: SlackHandlerDeps, chatId: string, userId?: string): Promise<void> {
  const dispatcher = new SlackOutputGateway(deps);
  const project = resolveProjectByChatId(deps.api, chatId);
  if (!project) {
    throw new Error("This Slack channel is not bound to a project yet.");
  }
  const { catalog } = await resolveThreadNewFormData(deps, project.id, userId);
  await dispatcher.dispatch(chatId, {
    kind: "thread_new_form",
    data: {
      kind: "thread_new_form",
      catalog
    }
  });
}
