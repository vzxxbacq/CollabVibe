/**
 * @module src/platform/platform-commands
 * @layer L1 (platform-agnostic shared)
 *
 * Pure business logic functions for non-agent commands.
 * Each function takes `OrchestratorApi` + parameters and returns typed data —
 * NO IM rendering, NO Feishu API calls. Rendering is the platform layer's job.
 *
 * ## Import Constraints (L1)
 * ✅ May import: services/contracts.ts (core-api types), src/platform/ (L1 shared)
 * ❌ Must NOT import: services/orchestrator/ (L2 internals)
 */
import type { OrchestratorApi } from "../../services/index";
import type { PlatformOutput, NotificationOutput } from "./platform-output";
import type { ProjectRecord } from "../../services/index";
import type { AppConfig } from "../config";
import type { ParsedIntent } from "./intent-types";
import { createLogger } from "../logging";
import { getPlatformCommandStrings } from "./platform-commands.strings";

const log = createLogger("handler");

/** platform-commands 的最小依赖 */
export interface CommandDeps {
  config: AppConfig;
  api: OrchestratorApi;
}

export function toNotificationOutput(text: string): NotificationOutput {
  return {
    kind: "notification",
    data: {
      kind: "notification",
      threadId: "",
      category: "agent_message",
      title: text,
    }
  };
}

// ── PROJECT_CREATE ──────────────────────────────────────────────────────────

export interface ProjectCreateResult {
  success: boolean;
  message: string;
  project?: { id: string; name: string; cwd: string };
}

export async function createProject(
  deps: CommandDeps, chatId: string, userId: string, args: { name?: string; cwd?: string; workBranch?: string }
): Promise<ProjectCreateResult> {
  const s = getPlatformCommandStrings(deps.config.locale);
  const existingProjectId = await deps.api.resolveProjectId(chatId);
  if (existingProjectId) {
    const existingProject = await deps.api.getProjectRecord(existingProjectId);
    log.warn({ chatId, userId, projectId: existingProjectId }, "createProject rejected: chat already bound");
    return { success: false, message: s.projectAlreadyBound(existingProject?.name ?? existingProjectId) };
  }
  const result = await deps.api.createProject({
    chatId,
    userId,
    actorId: userId,
    name: args.name,
    cwd: args.cwd || deps.config.cwd,
    workBranch: args.workBranch,
  });
  if (!result.success) {
    return { success: false, message: result.message };
  }
  log.info({ chatId, userId, project: result.project }, "project created");
  return result;
}

// ── PROJECT_LIST ────────────────────────────────────────────────────────────

export async function listProjects(deps: CommandDeps): Promise<ProjectRecord[]> {
  return await deps.api.listProjects();
}

// ── SKILL_LIST ──────────────────────────────────────────────────────────────

export async function listSkills(deps: CommandDeps, projectId?: string) {
  return deps.api.listSkills(projectId);
}

// ── SKILL_INSTALL ───────────────────────────────────────────────────────────

export async function installSkill(deps: CommandDeps, source: string, projectId?: string, userId?: string) {
  log.info({ source }, "installSkill requested");
  return deps.api.installSkill({ source, projectId, userId, actorId: userId ?? "system" });
}

// ── SKILL_REMOVE ────────────────────────────────────────────────────────────

export async function removeSkill(deps: CommandDeps, name: string, projectId?: string) {
  log.info({ name }, "removeSkill requested");
  return deps.api.removeSkill({ name, projectId, actorId: "system" });
}

// ── SNAPSHOT_LIST ───────────────────────────────────────────────────────────

export interface SnapshotListResult {
  snapshots: Awaited<ReturnType<OrchestratorApi["listSnapshots"]>>;
  threadId: string;
  threadName: string;
  hasBinding: boolean;
}

export async function listSnapshots(
  deps: CommandDeps, projectId: string, userId: string
): Promise<SnapshotListResult> {
  const s = getPlatformCommandStrings(deps.config.locale);
  const activeThread = userId ? await deps.api.getUserActiveThread({ projectId, userId }) : null;
  const threadId = activeThread?.threadId ?? "main";
  const threadName = activeThread?.threadName ?? s.snapshotThreadNameMain;
  const snapshots = await deps.api.listSnapshots({ projectId, threadId });
  return { snapshots, threadId, threadName, hasBinding: !!activeThread };
}

// ── MODEL_LIST ──────────────────────────────────────────────────────────────

export interface ModelListResult {
  currentModel: string;
  availableModels: string[];
  threadName?: string;
}

export async function resolveModelList(
  deps: CommandDeps, projectId: string, userId: string
): Promise<ModelListResult> {
  const activeThread = userId ? await deps.api.getUserActiveThread({ projectId, userId }) : null;
  const catalog = await deps.api.getBackendCatalog({ projectId, userId });
  const selectedBackendId = catalog.defaultSelection?.backendId;
  const selectedBackend = catalog.backends.find((backend) => backend.backendId === selectedBackendId) ?? catalog.backends[0];
  const availableModels = Array.from(new Set((selectedBackend?.options ?? []).map((option) => option.model)));
  return {
    currentModel: catalog.defaultSelection?.model ?? availableModels[0] ?? "",
    availableModels,
    threadName: activeThread?.threadName
  };
}

// ── THREAD_NEW_FORM data ────────────────────────────────────────────────────

export interface ThreadNewFormData {
  catalog: Awaited<ReturnType<OrchestratorApi["getBackendCatalog"]>>;
}

export async function resolveThreadNewFormData(
  deps: CommandDeps, projectId: string, userId?: string
): Promise<ThreadNewFormData> {
  return {
    catalog: await deps.api.getBackendCatalog({ projectId, userId })
  };
}

// ── ADMIN_ADD / ADMIN_REMOVE / ADMIN_LIST ───────────────────────────────

export interface AdminCommandResult {
  text: string;
}

export async function handleAdminIntent(
  deps: CommandDeps,
  intent: ParsedIntent
): Promise<AdminCommandResult> {
  const s = getPlatformCommandStrings(deps.config.locale);

  if (intent.intent === "ADMIN_LIST") {
    const admins = await deps.api.listAdmins();
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
    await deps.api.addAdmin(target);
    log.info({ target }, "admin added");
    return { text: s.adminAdded(target.slice(-8)) };
  }

  if (intent.intent === "ADMIN_REMOVE") {
    const result = await deps.api.removeAdmin(target);
    if (!result.ok) {
      log.warn({ target, reason: result.reason }, "admin remove rejected");
      return { text: s.adminRemoveRejected(result.reason ?? "") };
    }
    log.info({ target }, "admin removed");
    return { text: s.adminRemoved(target.slice(-8)) };
  }

  return { text: s.adminUnknownSubcommand };
}

export async function handleAdminIntentOutput(
  deps: CommandDeps,
  intent: ParsedIntent
): Promise<PlatformOutput> {
  return toNotificationOutput((await handleAdminIntent(deps, intent)).text);
}

// ── USER_LIST / USER_ADD / USER_ROLE / USER_REMOVE ──────────────────────

export interface UserCommandResult {
  text: string;
}

export async function handleUserIntent(
  deps: CommandDeps,
  projectId: string,
  _userId: string,
  intent: ParsedIntent
): Promise<UserCommandResult> {
  const s = getPlatformCommandStrings(deps.config.locale);
  const project = await deps.api.getProjectRecord(projectId);
  if (!project) {
    return { text: s.userProjectMissing };
  }

  const members = await deps.api.listProjectMembers(projectId);

  if (intent.intent === "USER_LIST") {
    const lines = members.map(m => `• ${m.userId.slice(-8)} — ${m.role}`);
    const admins = await deps.api.listAdmins();
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
    if (members.some(async m => m.userId === target)) {
      log.warn({ projectId, target }, "user add rejected: already exists");
      return { text: s.userAlreadyExists };
    }
    await deps.api.addProjectMember({ projectId, userId: target, role: newRole as "maintainer" | "developer" | "auditor", actorId: _userId });
    log.info({ projectId, target, role: newRole }, "user added to project");
    return { text: s.userAdded(target.slice(-8), newRole) };
  }

  if (intent.intent === "USER_ROLE") {
    const newRole = String(intent.args.role ?? "");
    if (!["maintainer", "developer", "auditor"].includes(newRole)) {
      return { text: s.userInvalidRole };
    }
    const existing = members.find(m => m.userId === target);
    if (!existing) {
      return { text: s.userNotMember(target.slice(-8)) };
    }
    await deps.api.updateProjectMemberRole({ projectId, userId: target, role: newRole as "maintainer" | "developer" | "auditor", actorId: _userId });
    log.info({ projectId, target, role: newRole }, "user role updated");
    return { text: s.userRoleUpdated(target.slice(-8), newRole) };
  }

  if (intent.intent === "USER_REMOVE") {
    const existing = members.find(m => m.userId === target);
    if (!existing) {
      return { text: s.userNotMember(target.slice(-8)) };
    }
    await deps.api.removeProjectMember({ projectId, userId: target, actorId: _userId });
    log.info({ projectId, target }, "user removed from project");
    return { text: s.userRemoved(target.slice(-8)) };
  }

  return { text: s.userUnknownSubcommand };
}

export async function handleUserIntentOutput(
  deps: CommandDeps,
  projectId: string,
  userId: string,
  intent: ParsedIntent
): Promise<PlatformOutput> {
  return toNotificationOutput((await handleUserIntent(deps, projectId, userId, intent)).text);
}
