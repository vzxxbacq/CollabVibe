import type { AgentApi, AgentApiFactory, RuntimeConfig } from "../../../../packages/agent-core/src/types";

export class AgentApiFactoryRegistry implements AgentApiFactory {
  constructor(private readonly factories: Record<string, AgentApiFactory>) {}

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
