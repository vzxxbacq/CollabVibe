import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { resolve as pathResolve, sep as pathSep } from "node:path";

import { createLogger } from "../../packages/logger/src/index";
import type { AdminStateStore } from "./admin-state";
import type { ProjectRecord, MemberRecord, ProjectRole } from "./project-types";
import type { OrchestratorConfig } from "./orchestrator-config";
import type { GitOps } from "../../packages/git-utils/src/index";
import type { ProjectResolver } from "./project-resolver";

const log = createLogger("server");

export interface SetupProjectInput {
  chatId: string;
  projectName: string;
  projectCwd: string;
  gitUrl?: string;
  gitToken?: string;
  /** Custom work branch name (e.g. "dev"). Defaults to `codex/{projectName}` if omitted. */
  workBranch?: string;
  ownerId: string;
}

export interface SetupResult {
  projectId: string;
  projectName: string;
  cwd: string;
  defaultBranch: string;
  workBranch: string;
  gitUrl?: string;
  ownerId: string;
}

export interface BindResult {
  projectId: string;
  projectName: string;
  cwd: string;
  defaultBranch?: string;
  gitUrl?: string;
}

export interface EncodedProjectFileInput {
  encoding: "base64";
  contentBase64: string;
}

export interface UnbindResult {
  projectId: string;
  projectName: string;
  oldChatId: string;
  newStatus: "disabled";
}

export class ProjectSetupService {
  constructor(
    private readonly adminStateStore: Pick<AdminStateStore, "read" | "write">,
    private readonly config: OrchestratorConfig,
    private readonly gitOps: GitOps,
  ) { }

  private disableAndUnbindProject(project: {
    id: string;
    name: string;
    chatId: string;
    status: "active" | "disabled";
    updatedAt?: string;
  }): UnbindResult {
    const oldChatId = project.chatId;
    project.status = "disabled";
    project.chatId = "";
    project.updatedAt = new Date().toISOString();
    return {
      projectId: project.id,
      projectName: project.name,
      oldChatId,
      newStatus: "disabled"
    };
  }

  async setupFromInitCard(input: SetupProjectInput): Promise<SetupResult> {
    const workspace = pathResolve(this.config.cwd);

    // S1: resolve 消除 .. 和相对段，检查 startsWith(workspace + sep) 防 /workspace-evil 前缀绕过
    const resolved = pathResolve(input.projectCwd);
    if (!resolved.startsWith(workspace + pathSep) && resolved !== workspace) {
      log.warn({ chatId: input.chatId, cwd: resolved, workspace }, "project setup rejected: outside workspace");
      throw new Error("工作目录越权：不在 workspace 范围内");
    }

    // S2: 禁止直接使用 workspace 根
    if (resolved === workspace) {
      log.warn({ chatId: input.chatId, workspace }, "project setup rejected: workspace root");
      throw new Error("不允许直接在 workspace 根目录创建项目，请指定子目录");
    }

    const state = await this.adminStateStore.read();
    const existing = state.projects.find((project) => project.chatId === input.chatId);
    if (existing) {
      log.warn({ chatId: input.chatId, projectId: existing.id }, "project setup rejected: chat already bound");
      throw new Error(`此群已绑定项目 "${existing.name}"`);
    }

    await mkdir(resolved, { recursive: true });

    // S3: realpath 解析符号链接后二次校验（防 symlink jail escape）
    try {
      const real = await realpath(resolved);
      const realWorkspace = await realpath(workspace);
      if (!real.startsWith(realWorkspace + pathSep)) {
        await rm(resolved, { recursive: true, force: true }).catch(() => {});
        log.warn({ chatId: input.chatId, cwd: resolved, real, realWorkspace }, "project setup rejected: symlink escape");
        throw new Error("路径解析后超出 workspace 范围（疑似符号链接越狱）");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("workspace")) throw err;
      throw new Error("路径验证失败: " + (err instanceof Error ? err.message : String(err)));
    }

    if (input.gitUrl) {
      let cloneUrl = input.gitUrl;
      if (input.gitToken && cloneUrl.startsWith("https://")) {
        cloneUrl = cloneUrl.replace("https://", `https://${input.gitToken}@`);
      }
      await this.gitOps.repo.init(resolved, cloneUrl);
      log.info({ chatId: input.chatId, cwd: resolved, hasGitUrl: true }, "project repository initialized from remote");
    } else {
      await this.gitOps.repo.init(resolved);
      log.info({ chatId: input.chatId, cwd: resolved, hasGitUrl: false }, "project repository initialized");
    }

    const defaultBranch = await this.gitOps.repo.detectDefaultBranch(resolved);
    const workBranch = input.workBranch?.trim() || `collabvibe/${input.projectName}`;
    await this.gitOps.repo.ensureWorkBranch(resolved, workBranch, defaultBranch);

    const projectId = `proj-${Date.now().toString(36)}`;
    state.projects.push({
      id: projectId,
      name: input.projectName,
      chatId: input.chatId,
      cwd: resolved,
      defaultBranch,
      workBranch,
      enabledSkills: [],
      gitUrl: input.gitUrl,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approvalPolicy,
      status: "active",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (!state.members[projectId]) {
      state.members[projectId] = [];
    }
    const members = state.members[projectId]!;
    if (!members.some(m => m.userId === input.ownerId)) {
      members.push({ userId: input.ownerId, role: "maintainer" });
    }
    await this.adminStateStore.write(state);
    log.info({ chatId: input.chatId, projectId, cwd: resolved, ownerId: input.ownerId }, "project setup completed");

    return {
      projectId,
      projectName: input.projectName,
      cwd: resolved,
      defaultBranch,
      workBranch,
      gitUrl: input.gitUrl,
      ownerId: input.ownerId
    };
  }

  /**
   * Bind an existing unbound project to a chat.
   * The project must already exist with chatId === "".
   */
  async bindExistingProject(chatId: string, projectId: string, ownerId: string): Promise<BindResult> {
    const state = await this.adminStateStore.read();
    const project = state.projects.find(p => p.id === projectId);
    if (!project) {
      log.warn({ chatId, projectId }, "bindExistingProject rejected: missing project");
      throw new Error("项目不存在");
    }
    if (project.chatId) {
      log.warn({ chatId, projectId, existingChatId: project.chatId }, "bindExistingProject rejected: already bound");
      throw new Error(`项目 "${project.name}" 已绑定到其他群聊`);
    }
    const existingBound = state.projects.find(p => p.chatId === chatId);
    if (existingBound) {
      log.warn({ chatId, projectId: existingBound.id }, "bindExistingProject rejected: chat already bound");
      throw new Error(`此群已绑定项目 "${existingBound.name}"`);
    }
    project.chatId = chatId;
    project.status = "active";
    project.updatedAt = new Date().toISOString();
    if (!state.members[projectId]) {
      state.members[projectId] = [];
    }
    const members = state.members[projectId]!;
    if (!members.some(m => m.userId === ownerId)) {
      members.push({ userId: ownerId, role: "maintainer" });
    }
    if (!project.defaultBranch && project.cwd) {
      project.defaultBranch = await this.gitOps.repo.detectDefaultBranch(project.cwd);
    }
    await this.adminStateStore.write(state);
    log.info({ chatId, projectId, ownerId }, "existing project bound to chat");
    return {
      projectId: project.id,
      projectName: project.name,
      cwd: project.cwd,
      defaultBranch: project.defaultBranch,
      gitUrl: project.gitUrl
    };
  }

  /**
   * Disable and unbind a project by id.
   * This is the shared lifecycle operation used by admin project management.
   */
  async disableAndUnbindProjectById(projectId: string): Promise<UnbindResult | null> {
    const state = await this.adminStateStore.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      return null;
    }
    const result = this.disableAndUnbindProject(project);
    await this.adminStateStore.write(state);
    log.info({ projectId: result.projectId, oldChatId: result.oldChatId }, "project disabled and unbound");
    return result;
  }

  /**
   * Disable and unbind the project currently attached to a chat.
   * Used when the bot is removed from a group.
   */
  async disableAndUnbindProjectByChatId(chatId: string): Promise<UnbindResult | null> {
    const state = await this.adminStateStore.read();
    const project = state.projects.find((item) => item.chatId === chatId);
    if (!project) {
      return null;
    }
    const result = this.disableAndUnbindProject(project);
    await this.adminStateStore.write(state);
    log.info({ chatId, projectId: result.projectId }, "project disabled and unbound from chat");
    return result;
  }

  /**
   * Add or update the git remote origin for a project's working directory.
   */
  async updateGitRemote(projectCwd: string, gitUrl: string, gitToken?: string): Promise<void> {
    let url = gitUrl;
    if (gitToken && url.startsWith("https://")) {
      url = url.replace("https://", `https://${gitToken}@`);
    }
    await this.gitOps.repo.setRemoteUrl(projectCwd, url);
    log.info({ cwd: projectCwd, hasGitToken: Boolean(gitToken) }, "project git remote updated");
  }

  /* ── Project CRUD (C6: replaces L1 raw adminStateStore.read/write) ── */

  /** Get a project by its ID. Returns undefined if not found. */
  async getProjectById(projectId: string): Promise<ProjectRecord | undefined> {
    const state = await this.adminStateStore.read();
    return state.projects.find(p => p.id === projectId);
  }

  /**
   * Update mutable project fields.
   * Returns the updated project, or null if not found.
   * Validates name uniqueness if `name` is being changed.
   */
  async updateProject(projectId: string, patch: {
    name?: string;
    gitUrl?: string;
    workBranch?: string;
  }): Promise<ProjectRecord | null> {
    const state = await this.adminStateStore.read();
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return null;

    if (patch.name !== undefined && patch.name !== project.name) {
      if (state.projects.some(p => p.name === patch.name && p.id !== projectId)) {
        throw new Error(`项目名称 "${patch.name}" 已被占用`);
      }
      project.name = patch.name;
    }
    if (patch.gitUrl !== undefined) {
      project.gitUrl = patch.gitUrl || undefined;
    }
    if (patch.workBranch !== undefined && patch.workBranch) {
      project.workBranch = patch.workBranch;
    }
    project.updatedAt = new Date().toISOString();
    await this.adminStateStore.write(state);
    log.info({ projectId, patch: Object.keys(patch) }, "project updated");
    return project;
  }

  /**
   * Toggle project status between active/disabled.
   * Returns { project, wasActive } so caller can trigger side effects.
   */
  async toggleProjectStatus(projectId: string): Promise<{
    project: ProjectRecord;
    wasActive: boolean;
  } | null> {
    const state = await this.adminStateStore.read();
    const project = state.projects.find(p => p.id === projectId);
    if (!project) return null;
    const wasActive = project.status === "active";
    project.status = wasActive ? "disabled" : "active";
    project.updatedAt = new Date().toISOString();
    await this.adminStateStore.write(state);
    log.info({ projectId, newStatus: project.status }, "project status toggled");
    return { project, wasActive };
  }

  /**
   * Re-enable a disabled project by ID.
   * Used when bot is re-added to a chat with a disabled project.
   */
  async reactivateProject(projectId: string): Promise<boolean> {
    const state = await this.adminStateStore.read();
    const project = state.projects.find(p => p.id === projectId);
    if (!project || project.status === "active") return false;
    project.status = "active";
    project.updatedAt = new Date().toISOString();
    await this.adminStateStore.write(state);
    log.info({ projectId }, "project reactivated");
    return true;
  }

  /**
   * Permanently delete a project and its member list.
   * Returns the deleted project's chatId for side-effect cleanup (or null if not found).
   */
  async deleteProjectById(projectId: string): Promise<{ oldChatId: string } | null> {
    const state = await this.adminStateStore.read();
    const idx = state.projects.findIndex(p => p.id === projectId);
    if (idx < 0) return null;
    const project = state.projects[idx]!;
    const oldChatId = project.chatId;
    state.projects.splice(idx, 1);
    delete state.members[projectId];
    await this.adminStateStore.write(state);
    log.info({ projectId, oldChatId }, "project deleted");
    return { oldChatId };
  }

  /**
   * Update a member's role within a project.
   * Returns true if the member was found and updated, false otherwise.
   */
  async updateMemberRole(
    projectId: string, userId: string, role: ProjectRole
  ): Promise<boolean> {
    const state = await this.adminStateStore.read();
    const members = state.members[projectId] ?? [];
    const idx = members.findIndex(m => m.userId === userId);
    if (idx < 0) return false;
    members[idx] = { ...members[idx], role };
    state.members[projectId] = members;
    await this.adminStateStore.write(state);
    log.info({ projectId, userId, role }, "member role updated");
    return true;
  }

  /** List all projects (raw records). Used by admin panel data aggregation. */
  async listAllProjectsRaw(): Promise<ProjectRecord[]> {
    return (await this.adminStateStore.read()).projects;
  }

  /** List members for a specific project. */
  async listProjectMembers(projectId: string): Promise<MemberRecord[]> {
    return (await this.adminStateStore.read()).members[projectId] ?? [];
  }

  /** List unbound projects (chatId is empty). */
  async listUnboundProjects(): Promise<Array<{ id: string; name: string; cwd: string; gitUrl?: string }>> {
    return (await this.adminStateStore.read()).projects
      .filter((project) => !project.chatId)
      .map((project) => ({ id: project.id, name: project.name, cwd: project.cwd, gitUrl: project.gitUrl }));
  }

  async resolveProjectId(chatId: string): Promise<string | null> {
    return (await this.adminStateStore.read()).projects.find((project) => project.chatId === chatId)?.id ?? null;
  }

  async getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
    return (await this.getProjectById(projectId)) ?? null;
  }

  async writeProjectFiles(projectId: string, patch: {
    gitignoreContent?: string;
    agentsMdContent?: string;
  }): Promise<void> {
    const project = await this.getProjectById(projectId);
    if (!project) {
      throw new Error(`project not found: ${projectId}`);
    }
    const writes: Promise<void>[] = [];
    if (patch.gitignoreContent !== undefined) {
      writes.push(writeFile(pathResolve(project.cwd, ".gitignore"), patch.gitignoreContent, "utf-8"));
    }
    if (patch.agentsMdContent !== undefined) {
      writes.push(writeFile(pathResolve(project.cwd, "AGENTS.md"), patch.agentsMdContent, "utf-8"));
    }
    await Promise.all(writes);
  }

  async writeInitialProjectFiles(projectId: string, input: {
    agentsMd?: EncodedProjectFileInput;
    gitignore?: EncodedProjectFileInput;
  }): Promise<void> {
    const decode = (file: EncodedProjectFileInput | undefined, label: string): string | undefined => {
      if (!file) return undefined;
      if (file.encoding !== "base64") {
        throw new Error(`unsupported ${label} encoding: ${file.encoding}`);
      }
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(file.contentBase64) || file.contentBase64.length % 4 !== 0) {
        throw new Error(`${label} decode failed: invalid base64 payload`);
      }
      try {
        return Buffer.from(file.contentBase64, "base64").toString("utf-8");
      } catch (error) {
        throw new Error(`${label} decode failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await this.writeProjectFiles(projectId, {
      gitignoreContent: decode(input.gitignore, ".gitignore"),
      agentsMdContent: decode(input.agentsMd, "AGENTS.md"),
    });

    const project = await this.getProjectById(projectId);
    if (!project) {
      throw new Error(`project not found after writing initial files: ${projectId}`);
    }
    await this.gitOps.merge.commitChanges(
      project.cwd,
      "[collabvibe] initialize project control files",
      { projectId, phase: "project_init_control_files" }
    );
  }
}

export class ProjectService {
  constructor(
    private readonly projectSetupService: ProjectSetupService,
    private readonly onProjectDeactivated: (projectId: string) => Promise<void>,
    private readonly onProjectReactivated: (projectId: string) => Promise<void>,
    private readonly defaultProjectCwd: string,
  ) {}

  async resolveProjectId(chatId: string): Promise<string | null> {
    return this.projectSetupService.resolveProjectId(chatId);
  }

  async getProjectRecord(projectId: string): Promise<ProjectRecord | null> {
    return this.projectSetupService.getProjectRecord(projectId);
  }

  async createProject(input: {
    chatId: string;
    userId: string;
    name?: string;
    cwd?: string;
    gitUrl?: string;
    gitToken?: string;
    workBranch?: string;
    initialFiles?: {
      agentsMd?: EncodedProjectFileInput;
      gitignore?: EncodedProjectFileInput;
    };
  }): Promise<{
    success: boolean;
    message: string;
    project?: { id: string; name: string; cwd: string };
  }> {
    const projectName = input.name?.trim() || `project-${Date.now().toString(36)}`;
    const projectCwd = input.cwd?.trim() || this.defaultProjectCwd;
    const result = await this.projectSetupService.setupFromInitCard({
      chatId: input.chatId,
      ownerId: input.userId,
      projectName,
      projectCwd,
      gitUrl: input.gitUrl,
      gitToken: input.gitToken,
      workBranch: input.workBranch,
    });
    if (input.initialFiles) {
      await this.projectSetupService.writeInitialProjectFiles(result.projectId, input.initialFiles);
    }
    return {
      success: true,
      message: `project created: ${result.projectName}`,
      project: { id: result.projectId, name: result.projectName, cwd: result.cwd },
    };
  }

  async linkProjectToChat(input: { chatId: string; projectId: string; ownerId: string }): Promise<BindResult> {
    return this.projectSetupService.bindExistingProject(input.chatId, input.projectId, input.ownerId);
  }

  async unlinkProject(projectId: string): Promise<void> {
    const result = await this.projectSetupService.disableAndUnbindProjectById(projectId);
    if (result) {
      await this.onProjectDeactivated(projectId);
    }
  }

  async disableProject(projectId: string): Promise<void> {
    await this.unlinkProject(projectId);
  }

  async reactivateProject(projectId: string): Promise<void> {
    await this.projectSetupService.reactivateProject(projectId);
    const project = await this.projectSetupService.getProjectById(projectId);
    if (project?.chatId) {
      await this.onProjectReactivated(projectId);
    }
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.onProjectDeactivated(projectId);
    await this.projectSetupService.deleteProjectById(projectId);
  }

  async listProjects(): Promise<ProjectRecord[]> {
    return this.projectSetupService.listAllProjectsRaw();
  }

  async listUnboundProjects(): Promise<Array<{ id: string; name: string; cwd: string; gitUrl?: string }>> {
    return this.projectSetupService.listUnboundProjects();
  }

  async updateGitRemote(input: { projectId: string; gitUrl: string }): Promise<void> {
    const project = await this.projectSetupService.getProjectById(input.projectId);
    if (!project) {
      throw new Error(`project not found: ${input.projectId}`);
    }
    await this.projectSetupService.updateGitRemote(project.cwd, input.gitUrl);
  }

  async updateProjectConfig(input: {
    projectId: string;
    workBranch?: string;
    gitUrl?: string;
    gitignoreContent?: string;
    agentsMdContent?: string;
  }): Promise<void> {
    await this.projectSetupService.updateProject(input.projectId, {
      workBranch: input.workBranch,
      gitUrl: input.gitUrl,
    });
    await this.projectSetupService.writeProjectFiles(input.projectId, {
      gitignoreContent: input.gitignoreContent,
      agentsMdContent: input.agentsMdContent,
    });
  }

  async listProjectMembers(projectId: string): Promise<MemberRecord[]> {
    return this.projectSetupService.listProjectMembers(projectId);
  }
}

// ── Standalone project operations (C1 extraction) ────────────────────────────

/**
 * Push the project's workBranch to remote.
 * Extracted from orchestrator.ts — this is a pure git operation.
 */
export async function pushProjectWorkBranch(
  projectResolver: ProjectResolver,
  projectId: string,
  gitOps: GitOps,
): Promise<void> {
  const project = await projectResolver.findProjectById?.(projectId);
  if (!project) {
    throw new Error(`pushWorkBranch: project not found: ${projectId}`);
  }
  if (!project.gitUrl) {
    throw new Error(`pushWorkBranch: project has no gitUrl configured: ${projectId}`);
  }
  if (!project.workBranch) {
    throw new Error(`pushWorkBranch: project has no workBranch configured: ${projectId}`);
  }
  await gitOps.repo.push(project.cwd, project.workBranch);
}
