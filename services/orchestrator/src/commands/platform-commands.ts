/**
 * @module src/core/platform-commands
 * @layer Core (platform-agnostic)
 *
 * Pure business logic functions for non-agent commands.
 * Each function takes `CoreDeps` + parameters and returns typed data —
 * NO IM rendering, NO Feishu API calls. Rendering is the platform layer's job.
 *
 * ## Functions
 * | Function                  | Intent           | Returns                    |
 * |---------------------------|------------------|----------------------------|
 * | `createProject()`         | PROJECT_CREATE   | `ProjectCreateResult`      |
 * | `listProjects()`          | PROJECT_LIST     | `ProjectRecord[]`          |
 * | `listSkills()`            | SKILL_LIST       | installable skill array    |
 * | `installSkill()`          | SKILL_INSTALL    | installed skill definition |
 * | `removeSkill()`           | SKILL_REMOVE     | boolean                    |
 * | `listSnapshots()`         | SNAPSHOT_LIST    | `SnapshotListResult`       |
 * | `resolveModelList()`      | MODEL_LIST       | `ModelListResult`          |
 * | `resolveThreadNewFormData()` | THREAD_NEW    | `ThreadNewFormData`        |
 *
 * ## Import Constraints
 * ✅ May import: src/core/types, services/admin-api
 * ❌ Must NOT import: src/feishu/, channel-feishu
 *
 * ## Consumers
 * - `src/feishu/shared-handlers.ts` — calls these, then renders via FeishuOutputAdapter
 * - `src/feishu/feishu-message-handler.ts` — calls createProject for PROJECT_CREATE
 */
import type { CoreDeps } from "../handler-types";
import type { PlatformOutput, TextOutput } from "../../../contracts/im/platform-output";
import { MAIN_THREAD_NAME } from "../../../../packages/agent-core/src/constants";
import { createLogger } from "../../../../packages/logger/src/index";
import type { ProjectRecord } from "../../../contracts/admin/contracts";
import { detectDefaultBranch } from "../../../../packages/git-utils/src/index";
import { getPlatformCommandStrings } from "./platform-commands.strings";

const log = createLogger("handler");

export function toTextOutput(text: string): TextOutput {
  return { kind: "text", text };
}

// ── PROJECT_CREATE ──────────────────────────────────────────────────────────

export interface ProjectCreateResult {
  success: boolean;
  message: string;
  project?: { id: string; name: string; cwd: string };
}

export async function createProject(
  deps: CoreDeps, chatId: string, userId: string, args: { name?: string; cwd?: string; workBranch?: string }
): Promise<ProjectCreateResult> {
  const s = getPlatformCommandStrings(deps.config.locale);
  const existingProject = deps.findProjectByChatId(chatId);
  if (existingProject) {
    log.warn({ chatId, userId, projectId: existingProject.id }, "createProject rejected: chat already bound");
    return { success: false, message: s.projectAlreadyBound(existingProject.name) };
  }
  const name = args.name || `project-${Date.now()}`;
  const cwd = args.cwd || deps.config.cwd;
  const id = `proj-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  let defaultBranch = "main";
  try {
    defaultBranch = await detectDefaultBranch(cwd);
  } catch (error) {
    log.warn({ cwd, err: error instanceof Error ? error.message : String(error) }, "createProject: default branch detection failed, using 'main'");
  }
  const workBranch = args.workBranch?.trim() || `collabvibe/${name}`;
  const state = deps.adminStateStore.read();
  state.projects.push({
    id, name, chatId, cwd, defaultBranch, workBranch,
    enabledSkills: [],
    sandbox: deps.config.sandbox,
    approvalPolicy: deps.config.approvalPolicy,
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  if (!state.members[id]) state.members[id] = [];
  const members = state.members[id]!;
  if (!members.some(m => m.userId === userId)) {
    members.push({ userId, role: "maintainer" });
  }
  deps.adminStateStore.write(state);
  log.info({ chatId, userId, projectId: id, cwd, name }, "project created");
  return {
    success: true,
    message: s.projectCreated,
    project: { id, name, cwd }
  };
}

// ── PROJECT_LIST ────────────────────────────────────────────────────────────

export function listProjects(deps: CoreDeps): ProjectRecord[] {
  return deps.adminStateStore.read().projects;
}

// ── SKILL_LIST ──────────────────────────────────────────────────────────────

export async function listSkills(deps: CoreDeps) {
  return deps.pluginService.getInstallablePlugins();
}

// ── SKILL_INSTALL ───────────────────────────────────────────────────────────

export async function installSkill(deps: CoreDeps, source: string) {
  log.info({ source }, "installSkill requested");
  return deps.pluginService.install(source);
}

// ── SKILL_REMOVE ────────────────────────────────────────────────────────────

export async function removeSkill(deps: CoreDeps, name: string) {
  log.info({ name }, "removeSkill requested");
  return deps.pluginService.remove(name);
}

// ── SNAPSHOT_LIST ───────────────────────────────────────────────────────────

export interface SnapshotListResult {
  snapshots: Awaited<ReturnType<CoreDeps["orchestrator"]["listSnapshots"]>>;
  threadId: string;
  threadName: string;
  hasBinding: boolean;
}

export async function listSnapshots(
  deps: CoreDeps, chatId: string, userId: string
): Promise<SnapshotListResult> {
  const s = getPlatformCommandStrings(deps.config.locale);
  const activeThread = userId ? await deps.orchestrator.getUserActiveThread(chatId, userId) : null;
  const threadId = activeThread?.threadId ?? MAIN_THREAD_NAME;
  const threadName = activeThread?.threadName ?? s.snapshotThreadNameMain;
  const snapshots = await deps.orchestrator.listSnapshots(chatId, threadId);
  return { snapshots, threadId, threadName, hasBinding: !!activeThread };
}

// ── MODEL_LIST ──────────────────────────────────────────────────────────────

export interface ModelListResult {
  currentModel: string;
  availableModels: string[];
  threadName?: string;
}

export async function resolveModelList(
  deps: CoreDeps, chatId: string, userId: string
): Promise<ModelListResult> {
  const activeThread = userId ? await deps.orchestrator.getUserActiveThread(chatId, userId) : null;
  const session = await deps.orchestrator.resolveSession(chatId, activeThread?.threadName);
  return {
    currentModel: session.backend.model,
    availableModels: session.availableModels,
    threadName: activeThread?.threadName
  };
}

// ── THREAD_NEW_FORM data ────────────────────────────────────────────────────

export interface ThreadNewFormData {
  backends: Awaited<ReturnType<CoreDeps["orchestrator"]["listAvailableBackends"]>>;
  defaultBackend: string;
  defaultModel: string;
}

export async function resolveThreadNewFormData(
  deps: CoreDeps, chatId: string, userId?: string
): Promise<ThreadNewFormData> {
  const backends = await deps.orchestrator.listAvailableBackends();
  const activeThread = userId ? await deps.orchestrator.getUserActiveThread(chatId, userId) : null;
  const session = await deps.orchestrator.resolveSession(chatId, activeThread?.threadName);

  // Enrich backends with models (profiles) from config-service
  const enriched = await Promise.all(backends.map(async b => ({
    ...b,
    profiles: await deps.orchestrator.listModelsForBackend(b.name),
  })));

  return {
    backends: enriched,
    defaultBackend: session.backend.backendId,
    defaultModel: session.backend.model
  };
}

// ── ADMIN_ADD / ADMIN_REMOVE / ADMIN_LIST ───────────────────────────────

import type { ParsedIntent } from "../../../contracts/im/types";

export interface AdminCommandResult {
  text: string;
}

export function handleAdminIntent(
  deps: CoreDeps,
  intent: ParsedIntent
): AdminCommandResult {
  const s = getPlatformCommandStrings(deps.config.locale);
  const userRepo = deps.userRepository;

  if (intent.intent === "ADMIN_LIST") {
    const admins = userRepo.listAdmins();
    if (admins.length === 0) {
      return { text: s.adminListEmpty };
    }
    const lines = admins.map(a => {
      const tag = a.source === "env" ? "🔒 env" : "🌐 im";
      return `• ${a.userId.slice(-8)} — ${tag}`;
    });
    return { text: s.adminList(admins.length, lines.join("\n")) };
  }

  const target = String(intent.args.target ?? "").replace(/@_user_\d+/g, "").trim();
  if (!target) {
    return { text: s.adminTargetRequired };
  }

  if (intent.intent === "ADMIN_ADD") {
    userRepo.setAdmin(target, "im");
    log.info({ target }, "admin added");
    return { text: s.adminAdded(target.slice(-8)) };
  }

  if (intent.intent === "ADMIN_REMOVE") {
    const result = userRepo.removeAdmin(target);
    if (!result.ok) {
      log.warn({ target, reason: result.reason }, "admin remove rejected");
      return { text: s.adminRemoveRejected(result.reason ?? "") };
    }
    log.info({ target }, "admin removed");
    return { text: s.adminRemoved(target.slice(-8)) };
  }

  return { text: s.adminUnknownSubcommand };
}

export function handleAdminIntentOutput(
  deps: CoreDeps,
  intent: ParsedIntent
): PlatformOutput {
  return toTextOutput(handleAdminIntent(deps, intent).text);
}

// ── USER_LIST / USER_ADD / USER_ROLE / USER_REMOVE ──────────────────────
// Migrated from src/feishu/feishu-message-handler.ts to core layer.
// Returns pure text — NO IM rendering.

export interface UserCommandResult {
  text: string;
}

export function handleUserIntent(
  deps: CoreDeps,
  chatId: string,
  _userId: string,
  intent: ParsedIntent
): UserCommandResult {
  const s = getPlatformCommandStrings(deps.config.locale);
  const project = deps.findProjectByChatId(chatId);
  if (!project) {
    return { text: s.userProjectMissing };
  }

  const state = deps.adminStateStore.read();
  const members = state.members[project.id] ?? [];

  if (intent.intent === "USER_LIST") {
    const lines = members.map(m => `• ${m.userId.slice(-8)} — ${m.role}`);
    const admins = deps.userRepository.listAdmins();
    const adminLines = admins.map(a => {
      const tag = a.source === "env" ? "🔒" : "🌐";
      return `• ${a.userId.slice(-8)} — 🛡️ admin ${tag}`;
    });
    return {
      text: s.userList(
        project.name,
        members.length,
        lines.join("\n"),
        adminLines.length ? `\n\n🛡️ 系统管理员\n${adminLines.join("\n")}` : ""
      )
    };
  }

  const target = String(intent.args.target ?? "").replace(/@_user_\d+/g, "").trim();
  if (!target) {
    return { text: s.userTargetRequired };
  }

  if (intent.intent === "USER_ADD") {
    const newRole = String(intent.args.role ?? "developer");
    if (!["maintainer", "developer", "auditor"].includes(newRole)) {
      return { text: s.userInvalidRole };
    }
    if (members.some(m => m.userId === target)) {
      log.warn({ chatId, projectId: project.id, target }, "user add rejected: already exists");
      return { text: s.userAlreadyExists };
    }
    if (!state.members[project.id]) state.members[project.id] = [];
    state.members[project.id]!.push({ userId: target, role: newRole as "maintainer" | "developer" | "auditor" });
    deps.adminStateStore.write(state);
    log.info({ chatId, projectId: project.id, target, role: newRole }, "user added to project");
    return { text: s.userAdded(target.slice(-8), newRole) };
  }

  if (intent.intent === "USER_ROLE") {
    const newRole = String(intent.args.role ?? "");
    if (!["maintainer", "developer", "auditor"].includes(newRole)) {
      return { text: s.userInvalidRole };
    }
    const idx = members.findIndex(m => m.userId === target);
    if (idx < 0) {
      return { text: s.userNotMember(target.slice(-8)) };
    }
    members[idx] = { ...members[idx], role: newRole as "maintainer" | "developer" | "auditor" };
    state.members[project.id] = members;
    deps.adminStateStore.write(state);
    log.info({ chatId, projectId: project.id, target, role: newRole }, "user role updated");
    return { text: s.userRoleUpdated(target.slice(-8), newRole) };
  }

  if (intent.intent === "USER_REMOVE") {
    const idx = members.findIndex(m => m.userId === target);
    if (idx < 0) {
      return { text: s.userNotMember(target.slice(-8)) };
    }
    members.splice(idx, 1);
    state.members[project.id] = members;
    deps.adminStateStore.write(state);
    log.info({ chatId, projectId: project.id, target }, "user removed from project");
    return { text: s.userRemoved(target.slice(-8)) };
  }

  return { text: s.userUnknownSubcommand };
}

export function handleUserIntentOutput(
  deps: CoreDeps,
  chatId: string,
  userId: string,
  intent: ParsedIntent
): PlatformOutput {
  return toTextOutput(handleUserIntent(deps, chatId, userId, intent).text);
}
