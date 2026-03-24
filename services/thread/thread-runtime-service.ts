import type { AgentApi, AgentApiPool, RuntimeConfig, RuntimeConfigProvider } from "../../packages/agent-core/src/index";
import type { BackendIdentity, BackendId } from "../../packages/agent-core/src/index";
import type { BackendRegistry } from "../backend/registry";
import type { BackendConfigService } from "../backend/config-service";
import type { PluginService } from "../plugin/plugin-service";
import type { ProjectResolver } from "../project/project-resolver";
import type { ThreadRegistry } from "./contracts";
import type { ThreadRecord } from "./types";
import type { ThreadService } from "./thread-service";
import { createLogger } from "../../packages/logger/src/index";
import type { GitOps } from "../../packages/git-utils/src/index";
import { ALL_BACKEND_SKILL_DIRS } from "../plugin/plugin-paths";
import { OrchestratorError, ErrorCode } from "../errors";
import { join } from "node:path";
import { parseMergeResolverName } from "../merge/merge-naming";

const log = createLogger("thread-runtime");

export interface ThreadRuntimeBuildOverrides {
  cwd?: string;
  approvalPolicy?: string;
  profileName?: string;
}

export interface StaleThreadReport {
  updated: Array<{ threadName: string; oldSha: string; newSha: string }>;
  stale: Array<{ threadName: string; baseSha: string; workBranchHead: string }>;
  errors: Array<{ threadName: string; error: string }>;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ThreadRuntimeService {
  constructor(private readonly deps: {
    agentApiPool: AgentApiPool;
    runtimeConfigProvider: RuntimeConfigProvider;
    backendRegistry?: BackendRegistry;
    backendConfigService?: BackendConfigService;
    pluginService?: PluginService;
    threadRegistry?: ThreadRegistry;
    projectResolver?: ProjectResolver;
    threadService?: ThreadService;
    gitOps: GitOps;
  }) { }

  private withBackendRuntimeEnv(
    backend: BackendIdentity,
    projectCwd: string | undefined,
    env: Record<string, string> | undefined
  ): Record<string, string> | undefined {
    if (!projectCwd) return env;
    switch (backend.backendId) {
      case "codex":
        return { ...env, CODEX_HOME: join(projectCwd, ".codex") };
      case "opencode":
      case "claude-code":
      default:
        return env;
    }
  }

  async buildBaseThreadConfig(params: {
    projectId: string;
    threadName: string;
    backend: BackendIdentity;
    overrides?: ThreadRuntimeBuildOverrides;
  }): Promise<RuntimeConfig> {
    const { projectId, threadName, backend, overrides } = params;
    let baseConfig: RuntimeConfig;
    try {
      baseConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    } catch (error) {
      throw new Error(`CONFIG_ERROR: runtime config resolution failed for ${projectId}/${threadName}: ${toErrorMessage(error)}`);
    }

    // Backend-specific runtime env (e.g. CODEX_HOME) — serverCmd resolved by FactoryRegistry
    const env = this.withBackendRuntimeEnv(backend, overrides?.cwd ?? baseConfig.cwd, undefined);

    return {
      backend,
      cwd: overrides?.cwd ?? baseConfig.cwd,
      env,
      sandbox: baseConfig.sandbox,
      approvalPolicy: overrides?.approvalPolicy ?? baseConfig.approvalPolicy,
      threadName,
    };
  }

  async prepareThreadRuntimeConfig(params: {
    projectId: string;
    threadName: string;
    config: RuntimeConfig;
    backendId: BackendId;
    profileName?: string;
    ensureWorktree: boolean;
    existingWorktreePath?: string;
  }): Promise<RuntimeConfig> {
    const { projectId, threadName, backendId, profileName, ensureWorktree, existingWorktreePath } = params;
    const config: RuntimeConfig = {
      ...params.config,
      env: params.config.env ? { ...params.config.env } : undefined,
    };

    if (config.cwd) {
      const worktreePath = ensureWorktree
        ? this.deps.gitOps.worktree.getPath(config.cwd, threadName)
        : existingWorktreePath ?? this.deps.gitOps.worktree.getPath(config.cwd, threadName);
      if (ensureWorktree) {
        try {
          await this.deps.pluginService?.syncProjectSkills?.(projectId);
        } catch (error) {
          throw new Error(`SKILL_SYNC_FAILED: sync project skills failed for ${projectId}/${threadName}: ${toErrorMessage(error)}`);
        }
        try {
          await this.deps.gitOps.worktree.create(config.cwd, threadName, worktreePath, { pluginDirs: ALL_BACKEND_SKILL_DIRS, baseBranch: config.baseBranch });
        } catch (error) {
          throw new Error(`WORKTREE_MISSING: create worktree failed for ${projectId}/${threadName} at ${worktreePath}: ${toErrorMessage(error)}`);
        }
        // Capture baseSha (the commit the worktree was branched from) + worktreePath
        try {
          const baseSha = await this.deps.gitOps.worktree.getHeadSha(worktreePath);
          this.deps.threadRegistry?.update?.(projectId, threadName, {
            baseSha: baseSha,
            worktreePath,
            hasDiverged: false,
          });
        } catch (err) {
          log.warn({ projectId, threadName, err: toErrorMessage(err) }, "capture baseSha after worktree creation failed (non-critical)");
        }
      } else {
        try {
          await this.deps.gitOps.accessCheck(worktreePath);
        } catch (error) {
          throw new Error(`WORKTREE_MISSING: worktree missing for ${projectId}/${threadName} at ${worktreePath}: ${toErrorMessage(error)}`);
        }
      }
      const projectCwd = config.cwd;
      config.cwd = worktreePath;
      config.env = this.withBackendRuntimeEnv(config.backend, projectCwd, config.env);
    }

    if (config.cwd && this.deps.backendConfigService) {
      let allConfigs;
      try {
        allConfigs = await this.deps.backendConfigService.readAllConfigs();
      } catch (error) {
        throw new Error(`CONFIG_ERROR: backend config read failed for ${projectId}/${threadName}: ${toErrorMessage(error)}`);
      }
      const backendConfig = allConfigs.find(c => c.name === backendId);
      if (backendConfig) {
        // serverCmd is now resolved by FactoryRegistry — only deploy here
        try {
          backendConfig.deploy(config.cwd, profileName ?? "default");
        } catch (error) {
          throw new Error(`CONFIG_ERROR: backend deploy failed for ${projectId}/${threadName}: ${toErrorMessage(error)}`);
        }
      }
      const { mkdir } = await import("node:fs/promises");
      for (const dir of ALL_BACKEND_SKILL_DIRS) {
        try {
          await mkdir(`${config.cwd}/${dir}`, { recursive: true });
        } catch (error) {
          throw new Error(`PLUGIN_DIR_INIT_FAILED: ensure plugin dir failed for ${projectId}/${threadName} at ${config.cwd}/${dir}: ${toErrorMessage(error)}`);
        }
      }
    }

    return config;
  }

  async getOrCreateAgentApi(projectId: string, threadName: string, config: RuntimeConfig): Promise<AgentApi> {
    let api: AgentApi;
    try {
      api = await this.deps.agentApiPool.createWithConfig(projectId, threadName, config);
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("session/load failed")
        || message.includes("no rollout found for thread id")
        || message.includes("thread backend session not found")) {
        throw new Error(`BACKEND_SESSION_MISSING: failed to restore backend session for ${projectId}/${threadName}: ${message}`);
      }
      if (message.includes("server command missing")
        || message.includes("ACP server command missing")
        || message.includes("missing factory for transport")
        || message.includes("missing required environment variable")
        || message.includes("config")) {
        throw new Error(`CONFIG_ERROR: failed to create agent API for ${projectId}/${threadName}: ${message}`);
      }
      throw error;
    }
    if (!api) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `agent api unavailable for project-thread ${projectId}/${threadName}`
      );
    }
    return api;
  }

  async createForNewThread(params: {
    projectId: string;
    threadName: string;
    backend: BackendIdentity;
    backendId: BackendId;
    profileName?: string;
    overrides?: ThreadRuntimeBuildOverrides;
    mcpServers?: RuntimeConfig["mcpServers"];
  }): Promise<{ config: RuntimeConfig; api: AgentApi }> {
    const baseConfig = await this.buildBaseThreadConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: params.backend,
      overrides: params.overrides,
    });
    if (params.mcpServers?.length) {
      baseConfig.mcpServers = params.mcpServers;
    }
    const config = await this.prepareThreadRuntimeConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      config: baseConfig,
      backendId: params.backendId,
      profileName: params.profileName,
      ensureWorktree: true,
    });
    const api = await this.getOrCreateAgentApi(params.projectId, params.threadName, config);
    return { config, api };
  }

  async getOrCreateForExistingThread(params: {
    projectId: string;
    threadName: string;
    threadRecord: ThreadRecord;
  }): Promise<{ config: RuntimeConfig; api: AgentApi }> {
    try {
      await this.deps.pluginService?.ensureProjectThreadSkills?.(params.projectId, params.threadName, params.threadRecord.worktreePath);
    } catch (error) {
      throw new Error(`SKILL_SYNC_FAILED: ensure project thread skills failed for ${params.projectId}/${params.threadName}: ${toErrorMessage(error)}`);
    }
    const cached = this.deps.agentApiPool.get(params.projectId, params.threadName);
    const baseConfig = await this.buildBaseThreadConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: params.threadRecord.backend,
    });
    const existingWorktreePath = this.resolveExistingThreadWorktreePath({
      projectId: params.projectId,
      threadName: params.threadName,
      threadRecord: params.threadRecord,
      projectCwd: baseConfig.cwd,
    });
    if (cached) {
      const config = {
        ...baseConfig,
        cwd: existingWorktreePath,
        env: this.withBackendRuntimeEnv(params.threadRecord.backend, baseConfig.cwd, baseConfig.env),
      };
      return { config, api: cached };
    }
    const config = await this.prepareThreadRuntimeConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      config: baseConfig,
      backendId: params.threadRecord.backend.backendId,
      ensureWorktree: false,
      existingWorktreePath,
    });
    config.backendSessionId = params.threadRecord.threadId;
    const api = await this.getOrCreateAgentApi(params.projectId, params.threadName, config);
    return { config, api };
  }

  private resolveExistingThreadWorktreePath(params: {
    projectId: string;
    threadName: string;
    threadRecord: ThreadRecord;
    projectCwd?: string;
  }): string {
    const persisted = params.threadRecord.worktreePath?.trim();
    if (persisted) {
      return persisted;
    }
    if (parseMergeResolverName(params.threadName) !== null) {
      throw new Error(
        `WORKTREE_MISSING: merge resolver thread is missing required worktreePath: projectId=${params.projectId} threadName=${params.threadName}`
      );
    }
    if (!params.projectCwd) {
      throw new Error(
        `WORKTREE_MISSING: project cwd missing while resolving existing thread worktree: projectId=${params.projectId} threadName=${params.threadName}`
      );
    }
    return this.deps.gitOps.worktree.getPath(params.projectCwd, params.threadName);
  }

  // ── Pool delegation: cache lookup ──

  /** Pure cache lookup — returns null if no API exists for this project-thread key. */
  getApi(projectId: string, threadName: string): AgentApi | null {
    return this.deps.agentApiPool.get(projectId, threadName);
  }

  async resolveRequiredApi(projectId: string, threadName: string): Promise<AgentApi> {
    const cached = this.getApi(projectId, threadName);
    if (cached) {
      const record = await this.deps.threadService?.getRecord(projectId, threadName);
      await this.deps.pluginService?.ensureProjectThreadSkills?.(projectId, threadName, record?.worktreePath);
      return cached;
    }
    const record = (await this.deps.threadService?.getRecord(projectId, threadName))
      ?? (await this.deps.threadRegistry?.get(projectId, threadName))
      ?? null;
    if (!record) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `agent api unavailable for project-thread ${projectId}/${threadName}`
      );
    }
    throw new OrchestratorError(
      ErrorCode.AGENT_API_UNAVAILABLE,
      `agent api unavailable for project-thread ${projectId}/${threadName}: session not preloaded at startup`
    );
  }

  async respondUserInput(projectId: string, threadName: string, callId: string, answers: Record<string, string[]>): Promise<void> {
    const api = await this.resolveRequiredApi(projectId, threadName);
    if (!api.respondUserInput) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "No active agent supporting user input response");
    }
    await api.respondUserInput({ callId, answers });
  }

  // ── Pool delegation: lifecycle ──

  async releaseThread(projectId: string, threadName: string): Promise<void> {
    await this.deps.agentApiPool.releaseThread(projectId, threadName);
  }

  async releaseByPrefix(projectId: string): Promise<void> {
    await this.deps.agentApiPool.releaseByPrefix?.(projectId);
  }

  async releaseAll(): Promise<void> {
    await this.deps.agentApiPool.releaseAll?.();
  }

  // ── Unified ensure: get cached or build config + create ──

  /**
   * Get a cached API or build config and create a new one.
   * Used by merge resolver and other non-standard creation paths
   * that need an API without creating a new worktree.
   */
  async ensureApi(params: {
    projectId: string;
    threadName: string;
    backend: BackendIdentity;
    overrides?: { cwd?: string; approvalPolicy?: string };
  }): Promise<{ config: RuntimeConfig; api: AgentApi }> {
    const cached = this.deps.agentApiPool.get(params.projectId, params.threadName);
    if (cached) {
      const config = await this.buildBaseThreadConfig({
        projectId: params.projectId,
        threadName: params.threadName,
        backend: params.backend,
        overrides: params.overrides,
      });
      return { config, api: cached };
    }
    const config = await this.buildBaseThreadConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: params.backend,
      overrides: params.overrides,
    });
    const api = await this.getOrCreateAgentApi(params.projectId, params.threadName, config);
    return { config, api };
  }

  async deleteThread(projectId: string, threadName: string): Promise<void> {
    const project = await this.deps.projectResolver?.findProjectById?.(projectId);
    if (!project?.cwd) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project cwd not found for projectId: ${projectId}`);
    }

    // Guard: thread must exist in registry before attempting deletion
    const record = await this.deps.threadService?.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.THREAD_NOT_FOUND, `thread not found: ${projectId}/${threadName}`);
    }

    await this.releaseThread(projectId, threadName);

    const worktreePath = record.worktreePath?.trim()
      || this.deps.gitOps.worktree.getPath(project.cwd, threadName);
    if (parseMergeResolverName(threadName) === null) {
      await this.deps.gitOps.worktree.remove(project.cwd, worktreePath, threadName);
    }
    await this.deps.threadService?.markMerged(projectId, threadName);
  }

  async detectStaleThreads(projectId: string, mergedThreadName: string): Promise<StaleThreadReport> {
    const project = await this.deps.projectResolver?.findProjectById?.(projectId);
    if (!project?.cwd) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project cwd not found for projectId: ${projectId}`);
    }
    if (!this.deps.threadRegistry) {
      throw new Error("ThreadRegistry is required for stale thread detection");
    }

    const workBranchHead = await this.deps.gitOps.worktree.getHeadSha(project.cwd);
    const report: StaleThreadReport = { updated: [], stale: [], errors: [] };

    for (const thread of await this.deps.threadRegistry.list(projectId)) {
      if (thread.threadName === mergedThreadName || !thread.baseSha || thread.baseSha === workBranchHead) {
        continue;
      }

      try {
        if (!thread.hasDiverged) {
          const worktreePath = thread.worktreePath ?? this.deps.gitOps.worktree.getPath(project.cwd, thread.threadName);
          const newSha = await this.deps.gitOps.worktree.fastForward(worktreePath, project.workBranch);
          this.deps.threadRegistry.update?.(projectId, thread.threadName, { baseSha: newSha });
          report.updated.push({ threadName: thread.threadName, oldSha: thread.baseSha, newSha });
          log.info({ projectId, threadName: thread.threadName, oldSha: thread.baseSha, newSha }, "auto fast-forwarded thread");
          continue;
        }

        report.stale.push({ threadName: thread.threadName, baseSha: thread.baseSha, workBranchHead });
        log.info({ projectId, threadName: thread.threadName, baseSha: thread.baseSha, workBranchHead }, "thread is stale (has diverged)");
      } catch (error) {
        log.error({ projectId, threadName: thread.threadName, err: toErrorMessage(error) }, "detectStaleThreads: processing thread failed");
        report.errors.push({ threadName: thread.threadName, error: toErrorMessage(error) });
      }
    }

    return report;
  }
}
