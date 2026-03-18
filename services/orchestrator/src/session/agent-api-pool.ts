import type { AgentApi, AgentApiPool, RuntimeConfig, AgentApiFactory } from "../../../../packages/agent-core/src/types";
import type { AgentProcessManager } from "../../../../packages/agent-core/src/agent-process-manager";
import { MAIN_THREAD_NAME } from "../../../../packages/agent-core/src/constants";
import { createLogger } from "../../../../packages/logger/src/index";

const log = createLogger("api-pool");

type PoolState = "NOT_STARTED" | "STARTING" | "READY" | "FAILED" | "RELEASED";

interface PoolEntry {
  state: PoolState;
  api?: AgentApi;
  startPromise?: Promise<AgentApi>;
}

function projectThreadPoolKey(chatId: string, threadName?: string): string {
  return `${chatId}:${threadName ?? MAIN_THREAD_NAME}`;
}

export class DefaultAgentApiPool implements AgentApiPool {
  private readonly apiFactory: AgentApiFactory;

  private readonly processManager?: AgentProcessManager;

  private readonly entries = new Map<string, PoolEntry>();

  constructor(deps: {
    apiFactory: AgentApiFactory;
    processManager?: AgentProcessManager;
  }) {
    this.apiFactory = deps.apiFactory;
    this.processManager = deps.processManager;
  }

  getLifecycleState(chatId: string, userId?: string): PoolState {
    const prefix = `${chatId}:`;
    for (const [key, entry] of this.entries.entries()) {
      if (key.startsWith(prefix) && entry.state !== "RELEASED" && entry.state !== "NOT_STARTED") {
        return entry.state;
      }
    }
    return "NOT_STARTED";
  }

  /**
   * Create a new API from a pre-built RuntimeConfig. Caches by project-thread key (derived from bound chatId + threadName).
   * This is the preferred creation path — config is assembled externally by orchestrator.
   */
  async createWithConfig(chatId: string, threadName: string, config: RuntimeConfig): Promise<AgentApi> {
    const key = projectThreadPoolKey(chatId, threadName);
    const existing = this.entries.get(key);
    if (existing?.state === "READY" && existing.api) {
      return existing.api;
    }
    if (existing?.state === "STARTING" && existing.startPromise) {
      return existing.startPromise;
    }

    const startPromise = (async () => {
      log.info({ key, serverCmd: config.serverCmd, transport: config.backend.transport, model: config.backend.model, cwd: config.cwd, envKeys: config.env ? Object.keys(config.env) : [] }, "creating API from config");
      const api = await this.apiFactory.create({ ...config, chatId, threadName });
      log.info({ key, backendType: api.backendType }, "API session created");
      this.entries.set(key, { state: "READY", api });
      return api;
    })();

    this.entries.set(key, { state: "STARTING", startPromise });

    try {
      return await startPromise;
    } catch (error) {
      if (this.processManager) {
        await this.processManager.stop(key);
      }
      this.entries.set(key, { state: "FAILED" });
      throw error;
    }
  }

  /**
   * Pure cache lookup — returns null if no API exists for this project-thread key.
   */
  get(chatId: string, threadName: string): AgentApi | null {
    const key = projectThreadPoolKey(chatId, threadName);
    const entry = this.entries.get(key);
    if (entry?.state === "READY" && entry.api) {
      return entry.api;
    }
    return null;
  }


  async releaseThread(chatId: string, threadName: string): Promise<void> {
    const key = projectThreadPoolKey(chatId, threadName);
    const entry = this.entries.get(key);
    if (!entry?.api) {
      this.entries.set(key, { state: "RELEASED" });
      return;
    }
    if (this.apiFactory.dispose) {
      await this.apiFactory.dispose(entry.api);
    }
    if (this.processManager) {
      await this.processManager.stop(key);
    }
    this.entries.set(key, { state: "RELEASED" });
  }

  async releaseByPrefix(chatId: string): Promise<void> {
    const prefix = `${chatId}:`;
    const keys = [...this.entries.keys()].filter(k => k.startsWith(prefix));
    for (const key of keys) {
      const threadName = key.slice(prefix.length);
      await this.releaseThread(chatId, threadName);
    }
  }


  async healthCheck(chatId: string, userId?: string): Promise<{ alive: boolean; threadCount: number }> {
    const prefix = `${chatId}:`;
    let totalThreads = 0;
    let anyAlive = false;
    for (const [key, entry] of this.entries.entries()) {
      if (key.startsWith(prefix) && entry.api) {
        totalThreads++;
        anyAlive = true;
      }
    }
    return { alive: anyAlive, threadCount: totalThreads };
  }

  async releaseAll(): Promise<void> {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.api && this.apiFactory.dispose) {
        await this.apiFactory.dispose(entry.api);
      }
      if (this.processManager) {
        await this.processManager.stop(key);
      }
      this.entries.set(key, { state: "RELEASED" });
    }
  }
}
