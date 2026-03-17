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
 * | `sendSnapshotList`  | `listSnapshots()`           | `feishuOutputAdapter.sendSnapshotOperation` |
 * | `sendModelList`     | `resolveModelList()`        | `feishuOutputAdapter.sendConfigOperation`  |
 * | `sendThreadNewForm` | `resolveThreadNewFormData()`| `feishuOutputAdapter.sendThreadNewForm`    |
 *
 * ## Import Constraints
 * ✅ May import: src/core/, src/feishu/types
 * ❌ Must NOT import: src/slack/
 */
import type { FeishuHandlerDeps } from "./types";
import {
  listProjects, listSnapshots as coreListSnapshots,
  resolveModelList, resolveThreadNewFormData
} from "../core/platform-commands";
import { createLogger } from "../../packages/channel-core/src/index";
import { getFeishuNotifyCatalog, notify } from "./feishu-notify";

const log = createLogger("handler");

// ── Project list ────────────────────────────────────────────────────────────

export async function sendProjectList(deps: FeishuHandlerDeps, chatId: string): Promise<void> {
    const { OP } = getFeishuNotifyCatalog(deps.config.locale);
    const projects = listProjects(deps);
    if (projects.length === 0) {
        await notify(deps, chatId, OP.NO_PROJECTS);
        return;
    }
    const lines = projects.map((project) => `• ${project.name} (${project.id}) — ${project.cwd}`);
    await notify(deps, chatId, OP.PROJECT_LIST(lines));
}

// ── Snapshot list ───────────────────────────────────────────────────────────

export async function sendSnapshotList(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<void> {
    const { OP } = getFeishuNotifyCatalog(deps.config.locale);
    const { snapshots, threadId, threadName, hasBinding } = await coreListSnapshots(deps, chatId, userId);
    if (snapshots.length === 0) {
        const hint = hasBinding
            ? OP.SNAPSHOT_EMPTY_THREAD(threadName)
            : OP.SNAPSHOT_EMPTY_MERGE;
        await notify(deps, chatId, hint);
        return;
    }
    const latestIndex = snapshots[snapshots.length - 1]!.turnIndex;
    await deps.feishuOutputAdapter.sendSnapshotOperation(chatId, {
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
    }, userId);
}

// ── Model list ──────────────────────────────────────────────────────────────

export async function sendModelList(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<void> {
    const { currentModel, availableModels, threadName } = await resolveModelList(deps, chatId, userId);
    await deps.feishuOutputAdapter.sendConfigOperation(chatId, {
        kind: "config_operation",
        action: "model_list",
        currentModel,
        availableModels,
        threadName
    }, userId);
}

// ── Thread new form data ────────────────────────────────────────────────────

export async function sendThreadNewForm(deps: FeishuHandlerDeps, chatId: string, userId?: string): Promise<void> {
    const { backends, defaultBackend, defaultModel } = await resolveThreadNewFormData(deps, chatId, userId);
    await deps.feishuOutputAdapter.sendThreadNewForm(chatId, {
        kind: "thread_new_form",
        backends,
        defaultBackend,
        defaultModel
    });
}

// ── Resolve functions (return card JSON, do NOT send) ───────────────────────

export async function resolveHelpCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const project = deps.findProjectByChatId(chatId);
    const isAdmin = deps.roleResolver?.resolve?.(userId, project?.id) === "admin";
    let members: Array<{ userId: string; displayName?: string; role: string }> | undefined;
    if (isAdmin && project) {
        const state = deps.adminStateStore.read();
        members = (state.members[project.id] ?? []).map(m => ({
            userId: m.userId, role: m.role
        }));
    }
    return deps.feishuOutputAdapter.buildHelpCard(userId, {
        isAdmin,
        members,
        projectId: project?.id,
        projectName: project?.name
    });
}

export async function resolveHelpThreadCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const threads = await deps.orchestrator.handleThreadListEntries(chatId);
    const activeThread = await deps.orchestrator.getUserActiveThread(chatId, userId);
    const isOnMain = !activeThread;
    const displayName = deps.feishuAdapter.getUserDisplayName
        ? await deps.feishuAdapter.getUserDisplayName(userId)
        : userId;
    return deps.feishuOutputAdapter.buildHelpThreadCard(
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
    const { backends, defaultBackend, defaultModel } = await resolveThreadNewFormData(deps, chatId, userId);
    return deps.feishuOutputAdapter.buildHelpThreadNewCard(
        userId, backends, defaultBackend, defaultModel
    );
}

export async function resolveHelpMergeCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const activeThread = await deps.orchestrator.getUserActiveThread(chatId, userId);
    const branchName = activeThread?.threadName;
    return deps.feishuOutputAdapter.buildHelpMergeCard(userId, branchName);
}

export async function resolveSnapshotCard(
    deps: FeishuHandlerDeps, chatId: string, userId: string, fromHelp?: boolean
): Promise<Record<string, unknown>> {
    const { snapshots, threadId, threadName } = await coreListSnapshots(deps, chatId, userId);
    const latestIndex = snapshots.length > 0 ? snapshots[snapshots.length - 1]!.turnIndex : -1;
    const displayName = deps.feishuAdapter.getUserDisplayName
        ? await deps.feishuAdapter.getUserDisplayName(userId)
        : userId;
    return deps.feishuOutputAdapter.buildSnapshotHistoryCard(
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
    const project = deps.findProjectByChatId(chatId);
    const skills = await deps.pluginService.getInstallablePlugins(project?.id);
    return deps.feishuOutputAdapter.buildHelpSkillCard(
        skills.map(s => ({
            name: s.name ?? s.pluginName ?? "unknown",
            description: s.description ?? "",
            installed: !!s.enabled
        })),
        userId
    );
}

export async function resolveHelpBackendCard(deps: FeishuHandlerDeps, userId: string): Promise<Record<string, unknown>> {
    const backends = await deps.orchestrator.listAvailableBackends();
    return deps.feishuOutputAdapter.buildHelpBackendCard(backends, userId);
}

export async function resolveHelpTurnCard(deps: FeishuHandlerDeps, chatId: string, userId: string): Promise<Record<string, unknown>> {
    const turns = await deps.orchestrator.listTurns(chatId, 20);
    log.debug({ chatId, userId, turnCount: turns.length }, "resolveHelpTurnCard");
    return deps.feishuOutputAdapter.buildTurnHistoryCard(
        turns.map((turn) => ({
            chatId: turn.chatId,
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
