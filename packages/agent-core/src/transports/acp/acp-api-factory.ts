import type { AgentApi, RuntimeConfig, AgentApiFactory } from "../../types";
import { MAIN_THREAD_NAME } from "../../constants";
import { createLogger } from "../../../../logger/src/index";

import { AcpApiAdapter } from "./acp-api-adapter";
import { AcpClient } from "./acp-client";
import { AcpProcessManager } from "./acp-process-manager";

const log = createLogger("acp-factory");

export class AcpApiFactory implements AgentApiFactory {
  private readonly metadata = new WeakMap<AgentApi, { projectThreadKey: string }>();

  constructor(private readonly processManager: AcpProcessManager = new AcpProcessManager()) { }

  async create(config: RuntimeConfig & { chatId: string; userId?: string }): Promise<AgentApi> {
    if (!config.serverCmd) {
      throw new Error("ACP server command missing");
    }
    // Project-thread key must be thread-scoped (matching pool key), NOT user-scoped.
    const threadName = config.threadName ?? MAIN_THREAD_NAME;
    const projectThreadKey = `${config.chatId}:${threadName}`;
    log.info({ projectThreadKey, serverCmd: config.serverCmd, cwd: config.cwd, transport: config.backend.transport, model: config.backend.model, envKeys: config.env ? Object.keys(config.env) : [] }, "creating ACP session");
    const process = await this.processManager.start(projectThreadKey, config.serverCmd, config.cwd, config.env);
    const client = new AcpClient(process as never, {
      chatId: config.chatId,
      threadName
    });
    log.info({ projectThreadKey }, "ACP client initializing");
    await client.initialize();
    log.info({ projectThreadKey }, "ACP client initialized");
    const api = new AcpApiAdapter(client);
    api.setCreationConfig(config);
    // Wire session persistence callback first — ensureSession may fall back to
    // session/new which triggers sessionIdChangedCallback to persist the new ID.
    if (config.onBackendSessionIdChanged) {
      api.onSessionIdChanged(config.onBackendSessionIdChanged);
    }
    // Eagerly establish session for existing threads (not new ones).
    // Throws if session/load fails — error propagates to handler → user notification.
    if (config.backendSessionId) {
      api.setBackendSessionId(config.backendSessionId);
      await api.ensureSession(config.backendSessionId, config);
    }
    this.metadata.set(api, { projectThreadKey });
    return api;
  }

  async dispose(api: AgentApi): Promise<void> {
    if (typeof (api as unknown as { close?: () => void }).close === "function") {
      (api as unknown as { close: () => void }).close();
    }
    const meta = this.metadata.get(api);
    if (meta) {
      await this.processManager.stop(meta.projectThreadKey);
    }
  }

  async healthCheck(): Promise<{ alive: boolean; threadCount: number }> {
    return { alive: true, threadCount: 0 };
  }
}
