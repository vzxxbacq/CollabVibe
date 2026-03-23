import type { AgentApi, AgentApiPool, RuntimeConfig, RuntimeConfigProvider } from "../../../../packages/agent-core/src/types";
import type { BackendIdentity, BackendId } from "../../../../packages/agent-core/src/backend-identity";
import type { BackendRegistry } from "../backend/registry";
import type { BackendConfigService } from "../backend/config-service";
import type { PluginService } from "../plugin/plugin-service";
import type { ThreadRecord } from "./thread-registry";
import { createLogger } from "../../../../packages/logger/src/index";
import { createWorktree, getWorktreePath } from "../../../../packages/git-utils/src/worktree";
import { git } from "../../../../packages/git-utils/src/git-exec";
import { ALL_BACKEND_SKILL_DIRS } from "../plugin/index";
import { OrchestratorError, ErrorCode } from "../errors";
import { join } from "node:path";
import { access } from "node:fs/promises";

const log = createLogger("thread-runtime");

export interface ThreadRuntimeBuildOverrides {
  cwd?: string;
  approvalPolicy?: string;
  profileName?: string;
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
    threadRegistry?: import("./thread-registry").ThreadRegistry;
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
  }): Promise<RuntimeConfig> {
    const { projectId, threadName, backendId, profileName, ensureWorktree } = params;
    const config: RuntimeConfig = {
      ...params.config,
      env: params.config.env ? { ...params.config.env } : undefined,
    };

    if (config.cwd) {
      const worktreePath = getWorktreePath(config.cwd, threadName);
      if (ensureWorktree) {
        try {
          await this.deps.pluginService?.syncProjectSkills?.(projectId);
        } catch (error) {
          throw new Error(`SKILL_SYNC_FAILED: sync project skills failed for ${projectId}/${threadName}: ${toErrorMessage(error)}`);
        }
        try {
          await createWorktree(config.cwd, threadName, worktreePath, { pluginDirs: ALL_BACKEND_SKILL_DIRS, baseBranch: config.baseBranch });
        } catch (error) {
          throw new Error(`WORKTREE_MISSING: create worktree failed for ${projectId}/${threadName} at ${worktreePath}: ${toErrorMessage(error)}`);
        }
        // Capture baseSha (the commit the worktree was branched from) + worktreePath
        try {
          const { stdout: sha } = await git(["rev-parse", "HEAD"], worktreePath);
          this.deps.threadRegistry?.update?.(projectId, threadName, {
            baseSha: sha.trim(),
            worktreePath,
            hasDiverged: false,
          });
        } catch (err) {
          log.warn({ projectId, threadName, err: toErrorMessage(err) }, "capture baseSha after worktree creation failed (non-critical)");
        }
      } else {
        try {
          await access(worktreePath);
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

  async getOrCreateAgentApi(chatId: string, threadName: string, config: RuntimeConfig): Promise<AgentApi> {
    let api: AgentApi;
    try {
      api = await this.deps.agentApiPool.createWithConfig(chatId, threadName, config);
    } catch (error) {
      const message = toErrorMessage(error);
      if (message.includes("session/load failed")
        || message.includes("no rollout found for thread id")
        || message.includes("thread backend session not found")) {
        throw new Error(`BACKEND_SESSION_MISSING: failed to restore backend session for ${chatId}/${threadName}: ${message}`);
      }
      if (message.includes("server command missing")
        || message.includes("ACP server command missing")
        || message.includes("missing factory for transport")
        || message.includes("missing required environment variable")
        || message.includes("config")) {
        throw new Error(`CONFIG_ERROR: failed to create agent API for ${chatId}/${threadName}: ${message}`);
      }
      throw error;
    }
    if (!api) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `agent api unavailable for project-thread ${chatId}/${threadName}`
      );
    }
    return api;
  }

  async createForNewThread(params: {
    projectId: string;
    chatId: string;
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
    const api = await this.getOrCreateAgentApi(params.chatId, params.threadName, config);
    return { config, api };
  }

  async getOrCreateForExistingThread(params: {
    projectId: string;
    chatId: string;
    threadName: string;
    threadRecord: ThreadRecord;
  }): Promise<{ config: RuntimeConfig; api: AgentApi }> {
    try {
      await this.deps.pluginService?.ensureProjectThreadSkills?.(params.projectId, params.threadName);
    } catch (error) {
      throw new Error(`SKILL_SYNC_FAILED: ensure project thread skills failed for ${params.projectId}/${params.threadName}: ${toErrorMessage(error)}`);
    }
    const cached = this.deps.agentApiPool.get(params.chatId, params.threadName);
    if (cached) {
      const config = await this.buildBaseThreadConfig({
        projectId: params.projectId,
        threadName: params.threadName,
        backend: params.threadRecord.backend,
      });
      return { config, api: cached };
    }

    const baseConfig = await this.buildBaseThreadConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: params.threadRecord.backend,
    });
    const config = await this.prepareThreadRuntimeConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      config: baseConfig,
      backendId: params.threadRecord.backend.backendId,
      ensureWorktree: false,
    });
    config.backendSessionId = params.threadRecord.threadId;
    const api = await this.getOrCreateAgentApi(params.chatId, params.threadName, config);
    return { config, api };
  }

  // ── Pool delegation: cache lookup ──

  /** Pure cache lookup — returns null if no API exists for this project-thread key. */
  getApi(chatId: string, threadName: string): AgentApi | null {
    return this.deps.agentApiPool.get(chatId, threadName);
  }

  // ── Pool delegation: lifecycle ──

  async releaseThread(chatId: string, threadName: string): Promise<void> {
    await this.deps.agentApiPool.releaseThread(chatId, threadName);
  }

  async releaseByPrefix(chatId: string): Promise<void> {
    await this.deps.agentApiPool.releaseByPrefix?.(chatId);
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
    chatId: string;
    threadName: string;
    backend: BackendIdentity;
    overrides?: { cwd?: string; approvalPolicy?: string };
  }): Promise<{ config: RuntimeConfig; api: AgentApi }> {
    const cached = this.deps.agentApiPool.get(params.chatId, params.threadName);
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
    const api = await this.getOrCreateAgentApi(params.chatId, params.threadName, config);
    return { config, api };
  }
}
