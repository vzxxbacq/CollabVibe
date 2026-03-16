import type { BackendDefinition } from "./backend/registry";
import type { BackendConfigInfo, BackendConfigService } from "./backend/config-service";
import type { AvailableBackend, BackendSessionResolver, ResolvedBackendSession } from "./backend/session-resolver";
import type { DefaultBackendSessionResolver } from "./backend/session-resolver";
import { createLogger } from "../../../packages/channel-core/src/index";

export class BackendAdminService {
  private readonly log = createLogger("backend-admin");

  constructor(
    private readonly backendSessionResolver: (BackendSessionResolver & { reSync?(): Promise<void> }) | undefined,
    private readonly backendConfigService: BackendConfigService | undefined,
  ) {}

  async listBackends(): Promise<AvailableBackend[]> {
    if (!this.backendSessionResolver) return [];
    return this.backendSessionResolver.listAvailableBackends();
  }

  async listAvailableBackends(): Promise<AvailableBackend[]> {
    const backends = await this.listBackends();
    if (!this.backendConfigService) return backends;
    const configs = await this.backendConfigService.readAllConfigs();
    return backends.map(b => {
      const config = configs.find(c => c.name === b.name);
      if (!config) return b;
      const available = config.providers
        .flatMap(p => p.models.filter(m => m.available === true).map(m => m.name));
      return { ...b, models: available.length > 0 ? available : [] };
    });
  }

  async resolveBackend(name: string): Promise<BackendDefinition | undefined> {
    if (!this.backendSessionResolver) return undefined;
    return this.backendSessionResolver.resolveBackendByName(name);
  }

  async listModelsForBackend(backendId: string): Promise<{ name: string; model: string; modelId: string; provider: string; extras: Record<string, unknown> }[]> {
    if (!this.backendConfigService) return [];
    const configs = await this.backendConfigService.readAllConfigs();
    const backend = configs.find(c => c.name === backendId);
    if (!backend) return [];
    const result: { name: string; model: string; modelId: string; provider: string; extras: Record<string, unknown> }[] = [];
    for (const provider of backend.providers) {
      for (const m of provider.models) {
        result.push({ name: m.name, model: m.modelId, modelId: m.modelId, provider: provider.name, extras: m.extras });
      }
    }
    return result;
  }

  async resolveSession(chatId: string, threadName?: string): Promise<ResolvedBackendSession> {
    if (!this.backendSessionResolver) {
      throw new Error("backendSessionResolver is required");
    }
    return this.backendSessionResolver.resolve(chatId, threadName);
  }

  async readBackendConfigs(): Promise<BackendConfigInfo[]> {
    if (!this.backendConfigService) return [];
    return this.backendConfigService.readAllConfigs();
  }

  async adminAddProvider(backendName: string, providerName: string, baseUrl?: string, apiKeyEnv?: string, context?: Record<string, unknown>): Promise<void> {
    if (!this.backendConfigService) return;
    this.log.info({ backendId: backendName, providerName, baseUrl, apiKeyEnv, ...context }, "adminAddProvider");
    this.backendConfigService.addProvider(backendName, providerName, baseUrl, apiKeyEnv);
    await this.reSyncRegistry();
  }

  async adminRemoveProvider(backendName: string, providerName: string): Promise<void> {
    if (!this.backendConfigService) return;
    this.backendConfigService.removeProvider(backendName, providerName);
    await this.reSyncRegistry();
  }

  async adminAddModel(backendName: string, providerName: string, modelName: string, modelConfig?: Record<string, unknown>, context?: Record<string, unknown>): Promise<void> {
    if (!this.backendConfigService) return;
    this.log.info({ backendId: backendName, providerName, modelName, hasConfig: !!modelConfig, ...context }, "adminAddModel");
    this.backendConfigService.addModel(backendName, providerName, modelName, modelConfig);
    await this.reSyncRegistry();
    this.backendConfigService.validateModel(backendName, providerName, modelName)
      .then(() => this.reSyncRegistry())
      .catch(err => this.log.warn({ backendId: backendName, providerName, modelName, ...context, err: err instanceof Error ? err.message : err }, "fire-and-forget validate failed"));
  }

  async adminRemoveModel(backendName: string, providerName: string, modelName: string): Promise<void> {
    if (!this.backendConfigService) return;
    this.backendConfigService.removeModel(backendName, providerName, modelName);
    await this.reSyncRegistry();
  }

  adminWriteProfile(backendId: string, profileName: string, model: string, provider: string, extras?: Record<string, unknown>, context?: Record<string, unknown>): void {
    if (!this.backendConfigService) return;
    this.log.info({ backendId, providerName: provider, profileName, modelName: model, ...context }, "adminWriteProfile");
    this.backendConfigService.writeProfile(backendId, {
      name: profileName,
      model,
      provider,
      extras: extras ?? {},
    });
    this.backendConfigService.validateModel(backendId, provider, profileName)
      .then(() => this.reSyncRegistry())
      .catch(err => this.log.warn({ backendId, providerName: provider, profileName, modelName: model, ...context, err: err instanceof Error ? err.message : err }, "profile auto-validate failed"));
  }

  adminDeleteProfile(backendId: string, profileName: string): void {
    if (!this.backendConfigService) return;
    this.backendConfigService.deleteProfile(backendId, profileName);
  }

  async adminTriggerRecheck(backendName: string, providerName: string, context?: Record<string, unknown>): Promise<void> {
    if (!this.backendConfigService) return;
    this.log.info({ backendId: backendName, providerName, ...context }, "adminTriggerRecheck");
    this.backendConfigService.validateAllModels(backendName, providerName)
      .then(() => this.reSyncRegistry())
      .catch(err => this.log.warn({ backendId: backendName, providerName, ...context, err: err instanceof Error ? err.message : err }, "recheck failed"));
  }

  async readBackendPolicy(backendName: string): Promise<Record<string, string>> {
    if (!this.backendConfigService) return {};
    return this.backendConfigService.readPolicy(backendName);
  }

  updateBackendPolicy(backendName: string, field: string, value: string, context?: Record<string, unknown>): void {
    if (!this.backendConfigService) return;
    this.log.info({ backendId: backendName, policyField: field, ...context }, "updateBackendPolicy");
    this.backendConfigService.updatePolicy(backendName, field, value);
  }

  async runHealthCheck(): Promise<void> {
    if (!this.backendConfigService) return;
    const configs = await this.backendConfigService.readAllConfigs();
    for (const backend of configs) {
      for (const provider of backend.providers) {
        for (const model of provider.models) {
          this.backendConfigService.validateModel(backend.name, provider.name, model.name)
            .catch((error) => this.log.warn({
              backendName: backend.name,
              providerName: provider.name,
              modelName: model.name,
              err: error instanceof Error ? error.message : String(error)
            }, "health check validateModel failed"));
        }
      }
    }
    await this.reSyncRegistry();
  }

  async reSyncRegistry(): Promise<void> {
    const resolver = this.backendSessionResolver as DefaultBackendSessionResolver | undefined;
    if (resolver?.reSync) {
      await resolver.reSync();
    }
  }
}
