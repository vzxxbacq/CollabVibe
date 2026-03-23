/**
 * @module src/feishu/shared-handlers
 * @layer Feishu (platform-specific)
 *
 * Feishu-specific rendering wrappers for shared business logic.
 *
 * ## Pattern
 * Each function follows the same pattern:
 * 1. Call a pure function from `src/core/platform-commands` to fetch data
 * 2. Render the data via `FeishuOutputAdapter` (cards, messages, etc.)
 *
 * ## Functions
 * | Function            | Core function called        | Renders via                              |
 * |---------------------|-----------------------------|------------------------------------------|
 * | `sendProjectList`   | `listProjects()`            | `feishuAdapter.sendMessage`              |
 * | `sendSnapshotList`  | `listSnapshots()`           | `platformOutput.sendSnapshotOperation` |
 * | `sendModelList`     | `resolveModelList()`        | `platformOutput.sendConfigOperation`  |
 * | `sendThreadNewForm` | `resolveThreadNewFormData()`| `platformOutput.sendThreadNewForm`    |
 *
 * ## Import Constraints
 * ✅ May import: src/core/, src/feishu/types
 * ❌ Must NOT import: src/slack/
 */
import type { FeishuHandlerDeps } from "./types";
import { FeishuOutputGateway } from "./platform-output-dispatcher";
import {
  listProjects, listSnapshots as coreListSnapshots,
  resolveModelList, resolveThreadNewFormData
} from "../common/platform-commands";
import { resolveProjectByChatId } from "../common/project-resolution";
import { textNotification } from "../common/output-helpers";
import { createLogger } from "../logging";
import { getFeishuNotifyCatalog, notify } from "./feishu-notify";

const log = createLogger("handler");

// ── Project list ────────────────────────────────────────────────────────────

export async function sendProjectList(deps: FeishuHandlerDeps, chatId: string): Promise<void> {
    const dispatcher = new FeishuOutputGateway(deps);
    const { OP } = getFeishuNotifyCatalog(deps.config.locale);
    const projects = listProjects(deps);
    if (projects.length === 0) {
        await dispatcher.dispatch(chatId, textNotification(OP.NO_PROJECTS));
        return;
    }
    const lines = projects.map((project) => `• ${project.name} (${project.id}) — ${project.cwd}`);
    await dispatcher.dispatch(chatId, textNotification(OP.PROJECT_LIST(lines)));
}

// ── Snapshot list ───────────────────────────────────────────────────────────

export async function sendSnapshotList(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<void> {
    const dispatcher = new FeishuOutputGateway(deps);
    const { OP } = getFeishuNotifyCatalog(deps.config.locale);
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        await dispatcher.dispatch(chatId, textNotification(OP.SNAPSHOT_EMPTY_MERGE));
        return;
    }
    const { snapshots, threadId, threadName, hasBinding } = await coreListSnapshots(deps, project.id, userId);
    if (snapshots.length === 0) {
        const hint = hasBinding
            ? OP.SNAPSHOT_EMPTY_THREAD(threadName)
            : OP.SNAPSHOT_EMPTY_MERGE;
        await dispatcher.dispatch(chatId, textNotification(hint));
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

// ── Model list ──────────────────────────────────────────────────────────────

export async function sendModelList(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<void> {
    const dispatcher = new FeishuOutputGateway(deps);
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        throw new Error("No project bound to this chat");
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

// ── Thread new form data ────────────────────────────────────────────────────

export async function sendThreadNewForm(deps: FeishuHandlerDeps, chatId: string, userId?: string): Promise<void> {
    const dispatcher = new FeishuOutputGateway(deps);
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        throw new Error("No project bound to this chat");
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

// ── Resolve functions (return card JSON, do NOT send) ───────────────────────

export async function resolveHelpCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    const isAdmin = deps.api.resolveRole({ userId, projectId: project?.id }) === "admin";
    let members: Array<{ userId: string; displayName?: string; role: string }> | undefined;
    if (isAdmin && project) {
        const rawMembers = deps.api.listProjectMembers(project.id);
        members = await Promise.all(rawMembers.map(async (m) => ({
            userId: m.userId,
            displayName: await deps.feishuAdapter.getUserDisplayName?.(m.userId),
            role: m.role
        })));
    }
    return deps.platformOutput.buildHelpCard(userId, {
        isAdmin,
        members,
        projectId: project?.id,
        projectName: project?.name
    });
}

export async function resolveHelpThreadCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    const threads = await deps.api.listThreads({ projectId: project!.id, actorId: userId });
    const activeThread = await deps.api.getUserActiveThread({ projectId: project!.id, userId });
    const isOnMain = !activeThread;
    const displayName = deps.feishuAdapter.getUserDisplayName
        ? await deps.feishuAdapter.getUserDisplayName(userId)
        : userId;
    return deps.platformOutput.buildHelpThreadCard(
        threads.map(t => ({
            threadName: t.threadName,
            threadId: t.threadId,
            status: t.status,
            backendName: t.backendId,
            modelName: t.model,
            active: t.status === "active" && t.threadName === activeThread?.threadName,
        })),
        userId, displayName, isOnMain
    );
}

export async function resolveHelpThreadNewCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        throw new Error("No project bound to this chat");
    }
    const { catalog } = await resolveThreadNewFormData(deps, project.id, userId);
    return deps.platformOutput.buildHelpThreadNewCard(
        userId, catalog
    );
}

export async function resolveHelpMergeCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    const activeThread = project ? await deps.api.getUserActiveThread({ projectId: project.id, userId }) : null;
    const branchName = activeThread?.threadName;
    return deps.platformOutput.buildHelpMergeCard(userId, branchName);
}

export async function resolveSnapshotCard(
    deps: FeishuHandlerDeps, chatId: string, userId: string, fromHelp?: boolean
): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        throw new Error("No project bound to this chat");
    }
    const { snapshots, threadId, threadName } = await coreListSnapshots(deps, project.id, userId);
    const latestIndex = snapshots.length > 0 ? snapshots[snapshots.length - 1]!.turnIndex : -1;
    const displayName = deps.feishuAdapter.getUserDisplayName
        ? await deps.feishuAdapter.getUserDisplayName(userId)
        : userId;
    return deps.platformOutput.buildSnapshotHistoryCard(
        snapshots.map(s => ({
            turnId: s.turnId,
            turnIndex: s.turnIndex,
            agentSummary: s.agentSummary,
            filesChanged: s.filesChanged,
            createdAt: s.createdAt,
            isCurrent: s.turnIndex === latestIndex
        })),
        threadId, userId, displayName, threadName, fromHelp
    );
}

export async function resolveHelpSkillCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    const skills = await deps.api.listSkills(project?.id);
    return deps.platformOutput.buildHelpSkillCard(
        skills.map(s => ({
            name: s.name ?? "unknown",
            description: s.description ?? "",
            installed: !!s.enabled
        })),
        userId
    );
}

export async function resolveHelpBackendCard(deps: FeishuHandlerDeps, userId: string): Promise<Record<string, unknown>> {
    const backends = await deps.api.listAvailableBackends();
    return deps.platformOutput.buildHelpBackendCard(backends, userId);
}

export async function resolveHelpTurnCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        throw new Error("No project bound to this chat");
    }
    const turns = await deps.api.listTurns({ projectId: project.id, limit: 20 });
    log.debug({ chatId, userId, turnCount: turns.length }, "resolveHelpTurnCard");
    return deps.platformOutput.buildTurnHistoryCard(
        turns.map((turn) => ({
            chatId,
            turnId: turn.turnId,
            threadName: turn.threadName,
            turnNumber: turn.turnNumber,
            promptSummary: turn.promptSummary,
            message: turn.lastAgentMessage,
            backendName: turn.backendName,
            modelName: turn.modelName,
            fileCount: turn.filesChangedCount,
            tokenUsage: turn.tokenUsage,
            actionTaken: turn.status === "accepted" || turn.status === "reverted" || turn.status === "interrupted"
                ? turn.status
                : undefined,
        })),
        userId,
        true
    );
}

export async function resolveHelpProjectCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const project = resolveProjectByChatId(deps.api, chatId);
    if (!project) {
        throw new Error("No project bound to this chat");
    }
    const safeRead = (filePath: string): string => {
        try { return readFileSync(filePath, "utf-8"); } catch { return ""; }
    };
    return deps.platformOutput.buildHelpProjectCard({
        projectId: project.id,
        projectName: project.name,
        cwd: project.cwd,
        gitUrl: project.gitUrl ?? "",
        workBranch: project.workBranch ?? "",
        gitignoreContent: safeRead(join(project.cwd, ".gitignore")),
        agentsMdContent: safeRead(join(project.cwd, "AGENTS.md")),
    }, userId);
}
