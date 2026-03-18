import { mkdir, realpath, rm } from "node:fs/promises";
import { resolve as pathResolve, sep as pathSep } from "node:path";

import { createLogger } from "../../../packages/logger/src/index";
import type { AdminStateStore, OrchestratorConfig } from "../../../services/admin-api/src/contracts";
import { detectDefaultBranch, initRepo, setRemoteUrl } from "../../../packages/git-utils/src/index";

const log = createLogger("server");

export interface SetupProjectInput {
  chatId: string;
  projectName: string;
  projectCwd: string;
  gitUrl?: string;
  gitToken?: string;
  ownerId: string;
}

export interface SetupResult {
  projectId: string;
  projectName: string;
  cwd: string;
  defaultBranch: string;
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

export interface UnbindResult {
  projectId: string;
  projectName: string;
  oldChatId: string;
  newStatus: "disabled";
}

export class ProjectSetupService {
  constructor(
    private readonly adminStateStore: Pick<AdminStateStore, "read" | "write">,
    private readonly config: OrchestratorConfig
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

    const state = this.adminStateStore.read();
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
      await initRepo(resolved, cloneUrl);
      log.info({ chatId: input.chatId, cwd: resolved, hasGitUrl: true }, "project repository initialized from remote");
    } else {
      await initRepo(resolved);
      log.info({ chatId: input.chatId, cwd: resolved, hasGitUrl: false }, "project repository initialized");
    }

    const defaultBranch = await detectDefaultBranch(resolved);

    const projectId = `proj-${Date.now().toString(36)}`;
    state.projects.push({
      id: projectId,
      name: input.projectName,
      chatId: input.chatId,
      cwd: resolved,
      defaultBranch,
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
    this.adminStateStore.write(state);
    log.info({ chatId: input.chatId, projectId, cwd: resolved, ownerId: input.ownerId }, "project setup completed");

    return {
      projectId,
      projectName: input.projectName,
      cwd: resolved,
      defaultBranch,
      gitUrl: input.gitUrl,
      ownerId: input.ownerId
    };
  }

  /**
   * Bind an existing unbound project to a chat.
   * The project must already exist with chatId === "".
   */
  async bindExistingProject(chatId: string, projectId: string, ownerId: string): Promise<BindResult> {
    const state = this.adminStateStore.read();
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
      project.defaultBranch = await detectDefaultBranch(project.cwd);
    }
    this.adminStateStore.write(state);
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
    const state = this.adminStateStore.read();
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) {
      return null;
    }
    const result = this.disableAndUnbindProject(project);
    this.adminStateStore.write(state);
    log.info({ projectId: result.projectId, oldChatId: result.oldChatId }, "project disabled and unbound");
    return result;
  }

  /**
   * Disable and unbind the project currently attached to a chat.
   * Used when the bot is removed from a group.
   */
  async disableAndUnbindProjectByChatId(chatId: string): Promise<UnbindResult | null> {
    const state = this.adminStateStore.read();
    const project = state.projects.find((item) => item.chatId === chatId);
    if (!project) {
      return null;
    }
    const result = this.disableAndUnbindProject(project);
    this.adminStateStore.write(state);
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
    await setRemoteUrl(projectCwd, url);
    log.info({ cwd: projectCwd, hasGitToken: Boolean(gitToken) }, "project git remote updated");
  }
}
