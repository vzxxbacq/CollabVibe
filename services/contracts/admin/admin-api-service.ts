import type { EffectiveRole } from "../../orchestrator/src/iam/permissions";
import type { AdminPersistedState, AdminStateStore, MemberRecord, ProjectConfig, ProjectRole } from "./contracts";
export type { AdminPersistedState, AdminStateStore, MemberRecord, ProjectConfig, ProjectRole } from "./contracts";

export interface FeishuConfigInput {
  appId: string;
  appSecret: string;
  encryptKey: string;
  signingSecret: string;
}

export interface SecretStore {
  write(key: string, value: string): Promise<void>;
  read(key: string): Promise<string | null>;
}

interface ConnectivityCache {
  expiresAt: number;
  result: { ok: boolean; detail: string };
}

function cloneState(state: AdminPersistedState): AdminPersistedState {
  return JSON.parse(JSON.stringify(state)) as AdminPersistedState;
}

export class InMemoryAdminStateStore implements AdminStateStore {
  private state: AdminPersistedState = {
    wizardStep: {},
    projects: [],
    members: {}
  };

  read(): AdminPersistedState {
    return cloneState(this.state);
  }

  write(state: AdminPersistedState): void {
    this.state = cloneState(state);
  }
}

export class AdminApiService {

  private readonly secretStore: SecretStore;

  private readonly stateStore: AdminStateStore;

  private readonly wizardStep = new Map<string, number>();

  private readonly projects = new Map<string, ProjectConfig>();

  private readonly chatBindings = new Set<string>();

  private readonly members = new Map<string, MemberRecord[]>();

  private readonly connectivityCache = new Map<string, ConnectivityCache>();

  constructor(deps: { secretStore: SecretStore; stateStore?: AdminStateStore }) {
    this.secretStore = deps.secretStore;
    this.stateStore = deps.stateStore ?? new InMemoryAdminStateStore();

    const persisted = this.stateStore.read();
    for (const [orgId, step] of Object.entries(persisted.wizardStep)) {
      this.wizardStep.set(orgId, step);
    }
    for (const project of persisted.projects) {
      this.projects.set(project.id, project);
      this.chatBindings.add(project.chatId);
    }
    for (const [projectId, projectMembers] of Object.entries(persisted.members)) {
      this.members.set(projectId, [...projectMembers]);
    }
  }

  private persistState(): void {
    const members: Record<string, MemberRecord[]> = {};
    for (const [projectId, projectMembers] of this.members.entries()) {
      members[projectId] = [...projectMembers];
    }
    const wizardStep: Record<string, number> = {};
    for (const [orgId, step] of this.wizardStep.entries()) {
      wizardStep[orgId] = step;
    }
    this.stateStore.write({
      wizardStep,
      projects: [...this.projects.values()],
      members
    });
  }

  getWizardStep(orgId: string): number {
    return this.wizardStep.get(orgId) ?? 1;
  }

  submitWizardStep(orgId: string, step: number): number {
    const current = this.getWizardStep(orgId);
    if (step !== current) {
      throw new Error(`wizard step out of order: expected ${current}, got ${step}`);
    }
    const next = Math.min(5, step + 1);
    this.wizardStep.set(orgId, next);
    this.persistState();
    return next;
  }

  async saveFeishuConfig(orgId: string, config: FeishuConfigInput): Promise<void> {
    if (!config.appId || !config.appSecret || !config.encryptKey || !config.signingSecret) {
      throw new Error("feishu config missing required fields");
    }
    await this.secretStore.write(`feishu:${orgId}:appId`, config.appId);
    await this.secretStore.write(`feishu:${orgId}:appSecret`, config.appSecret);
    await this.secretStore.write(`feishu:${orgId}:encryptKey`, config.encryptKey);
    await this.secretStore.write(`feishu:${orgId}:signingSecret`, config.signingSecret);
  }

  async createProject(input: Omit<ProjectConfig, "status" | "createdAt" | "updatedAt" | "enabledSkills"> & { enabledSkills?: string[] }): Promise<ProjectConfig> {
    if ([...this.projects.values()].some((project) => project.name === input.name)) {
      throw new Error("project name already exists");
    }
    if (this.chatBindings.has(input.chatId)) {
      throw new Error("chat already bound");
    }

    const now = new Date().toISOString();
    const project: ProjectConfig = {
      ...input,
      enabledSkills: input.enabledSkills ?? [],
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    this.projects.set(project.id, project);
    this.chatBindings.add(project.chatId);
    this.persistState();
    return project;
  }

  listProjects(): ProjectConfig[] {
    return [...this.projects.values()];
  }

  findProjectByChatId(chatId: string): ProjectConfig | null {
    for (const project of this.projects.values()) {
      if (project.chatId === chatId) {
        return { ...project };
      }
    }
    return null;
  }

  updateProjectStatus(projectId: string, status: "active" | "disabled"): ProjectConfig {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("project not found");
    }
    const updated = { ...project, status, updatedAt: new Date().toISOString() };
    this.projects.set(projectId, updated);
    this.persistState();
    return updated;
  }

  /**
   * Update project metadata (name, gitUrl).
   * Name uniqueness is enforced within the same org scope.
   */
  updateProject(projectId: string, patch: { name?: string; gitUrl?: string }): ProjectConfig {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("project not found");
    }
    if (patch.name && patch.name !== project.name) {
      if ([...this.projects.values()].some(p => p.name === patch.name && p.id !== projectId)) {
        throw new Error("project name already exists");
      }
    }
    const updated: ProjectConfig = {
      ...project,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.gitUrl !== undefined ? { gitUrl: patch.gitUrl } : {}),
      updatedAt: new Date().toISOString()
    };
    this.projects.set(projectId, updated);
    this.persistState();
    return updated;
  }

  /**
   * Rebind a project to a different chat.
   * Pass empty string to unbind (release chatId without binding to new).
   */
  rebindChat(projectId: string, newChatId: string): ProjectConfig {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("project not found");
    }
    if (newChatId && this.chatBindings.has(newChatId)) {
      throw new Error("target chat already bound to another project");
    }
    // Release old binding
    if (project.chatId) {
      this.chatBindings.delete(project.chatId);
    }
    // Set new binding (may be empty = unbound)
    if (newChatId) {
      this.chatBindings.add(newChatId);
    }
    const updated: ProjectConfig = {
      ...project,
      chatId: newChatId,
      updatedAt: new Date().toISOString()
    };
    this.projects.set(projectId, updated);
    this.persistState();
    return updated;
  }

  /**
   * Delete a project entirely — releases chatId binding and cleans up members.
   * Returns the deleted project's chatId for platform-layer cleanup (e.g. bot leave chat).
   */
  deleteProject(projectId: string): { oldChatId: string } {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error("project not found");
    }
    const oldChatId = project.chatId;
    if (oldChatId) {
      this.chatBindings.delete(oldChatId);
    }
    this.projects.delete(projectId);
    this.members.delete(projectId);
    this.persistState();
    return { oldChatId };
  }

  /**
   * List projects that have no active chat binding (chatId is empty).
   * Used by Init Card dual-mode to offer "bind existing project" option.
   */
  listUnboundProjects(): ProjectConfig[] {
    return [...this.projects.values()].filter(p => !p.chatId);
  }

  async checkConnectivity(
    cacheKey: string,
    probe: () => Promise<{ ok: boolean; detail: string }>,
    ttlMs = 10_000
  ): Promise<{ ok: boolean; detail: string; cached: boolean }> {
    const now = Date.now();
    const cached = this.connectivityCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return { ...cached.result, cached: true };
    }
    const result = await probe();
    this.connectivityCache.set(cacheKey, {
      result,
      expiresAt: now + ttlMs
    });
    return { ...result, cached: false };
  }

  listMembers(projectId: string): MemberRecord[] {
    return [...(this.members.get(projectId) ?? [])];
  }

  inviteMember(projectId: string, actorRole: EffectiveRole, member: MemberRecord): MemberRecord {
    if (!["admin", "maintainer"].includes(actorRole)) {
      throw new Error("forbidden");
    }
    const members = this.members.get(projectId) ?? [];
    if (members.some((item) => item.userId === member.userId)) {
      throw new Error("member already exists");
    }
    members.push(member);
    this.members.set(projectId, members);
    this.persistState();
    return member;
  }

  updateMemberRole(projectId: string, actorRole: EffectiveRole, userId: string, role: ProjectRole): MemberRecord {
    if (!["admin", "maintainer"].includes(actorRole)) {
      throw new Error("forbidden");
    }
    const members = this.members.get(projectId) ?? [];
    const index = members.findIndex((member) => member.userId === userId);
    if (index < 0) {
      throw new Error("member not found");
    }
    const updated = { ...members[index], role };
    members[index] = updated;
    this.members.set(projectId, members);
    this.persistState();
    return updated;
  }
}
