import type { AgentApi, AgentApiFactory, RuntimeConfig } from "../../../../packages/agent-core/src/types";
import type { BackendRegistry } from "../backend/registry";
import type { BackendConfigService } from "../backend/config-service";

export class AgentApiFactoryRegistry implements AgentApiFactory {
  constructor(
    private readonly factories: Record<string, AgentApiFactory>,
    private readonly backendRegistry?: BackendRegistry,
    private readonly backendConfigService?: BackendConfigService,
  ) {}

  private factoryForTransport(transport?: string): AgentApiFactory {
    const key = transport === "acp" ? "acp" : "codex";
    const factory = this.factories[key];
    if (!factory) {
      throw new Error(`missing factory for transport: ${key}`);
    }
    return factory;
  }

  async create(config: RuntimeConfig & { chatId: string; userId?: string; threadName: string }): Promise<AgentApi> {
    const transport = config.backend.transport;
    // Phase 3: resolve serverCmd + env via backend-specific buildServerCmd (profile-aware)
    if (!config.serverCmd && this.backendConfigService) {
      try {
        const resolved = await this.backendConfigService.resolveServerCmd(
          config.backend.backendId, config.backend.model, config.cwd
        );
        config = { ...config, serverCmd: resolved.serverCmd, env: { ...resolved.env, ...config.env } };
      } catch {
        // Fallback to static registry if resolveServerCmd fails (e.g. missing config file)
        if (this.backendRegistry) {
          const def = this.backendRegistry.get(config.backend.backendId);
          if (def) {
            config = { ...config, serverCmd: def.serverCmd, env: { ...def.env, ...config.env } };
          }
        }
      }
    } else if (!config.serverCmd && this.backendRegistry) {
      // Fallback: static registry lookup (no profile override)
      const def = this.backendRegistry.get(config.backend.backendId);
      if (def) {
        config = { ...config, serverCmd: def.serverCmd, env: { ...def.env, ...config.env } };
      }
    }
    return this.factoryForTransport(transport).create(config);
  }

  async dispose(api: AgentApi): Promise<void> {
    const factory = this.factoryForTransport(api.backendType);
    if (factory.dispose) {
      await factory.dispose(api);
    }
  }

  async healthCheck(api: AgentApi): Promise<{ alive: boolean; threadCount: number }> {
    const factory = this.factoryForTransport(api.backendType);
    if (factory.healthCheck) {
      return factory.healthCheck(api);
    }
    return { alive: true, threadCount: 0 };
  }
}
