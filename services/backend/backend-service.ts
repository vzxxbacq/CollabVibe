import type { BackendDefinition } from "./registry";
import type { BackendConfigInfo, BackendConfigService } from "./config-service";
import { isBackendId, type BackendId } from "../../packages/agent-core/src/index";
import type { AvailableBackend, BackendSessionResolver, ResolvedBackendSession } from "./session-resolver";
import type { DefaultBackendSessionResolver } from "./session-resolver";
import { createLogger } from "../../packages/logger/src/index";

export interface BackendModelProfile {
  name: string;
  model: string;
  modelId: string;
  provider: string;
  extras: Record<string, unknown>;
}

export interface BackendCatalogOption {
  kind: "profile" | "model";
  profileName?: string;
  model: string;
  provider?: string;
  label: string;
  value: string;
  available: boolean;
  extras?: Record<string, unknown>;
}

export interface BackendCatalogView {
  defaultSelection?: {
    backendId: BackendId;
    model: string;
    profileName?: string;
    value: string;
  };
  backends: Array<{
    backendId: BackendId;
    description?: string;
    options: BackendCatalogOption[];
  }>;
}

export class BackendService {
  private readonly log = createLogger("backend-admin");

  constructor(
    private readonly backendSessionResolver: BackendSessionResolver & { reSync?(): Promise<void> },
    private readonly backendConfigService: BackendConfigService,
    private readonly resolveActiveThread?: (projectId: string, userId: string) => Promise<{ threadName: string } | null>,
  ) { }

  async listBackends(): Promise<AvailableBackend[]> {
    return this.backendSessionResolver.listAvailableBackends();
  }

  async listAvailableBackends(): Promise<AvailableBackend[]> {
    const backends = await this.listBackends();
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
    return this.backendSessionResolver.resolveBackendByName(name);
  }

  async listModelsForBackend(backendId: string): Promise<BackendModelProfile[]> {
    const configs = await this.backendConfigService.readAllConfigs();
    const backend = configs.find(c => c.name === backendId);
    if (!backend) return [];
    const result: BackendModelProfile[] = [];
    for (const provider of backend.providers) {
      for (const m of provider.models) {
        result.push({ name: m.name, model: m.modelId, modelId: m.modelId, provider: provider.name, extras: m.extras });
      }
    }
    return result;
  }

  async getBackendCatalog(input: { projectId: string; userId?: string }): Promise<BackendCatalogView> {
    const availableBackends = await this.listAvailableBackends();
    const activeThread = input.userId && this.resolveActiveThread
      ? await this.resolveActiveThread(input.projectId, input.userId)
      : null;
    const session = await this.resolveSession(input.projectId, activeThread?.threadName);
    const backends: BackendCatalogView["backends"] = [];

    for (const backend of availableBackends) {
      if (!isBackendId(backend.name)) continue;
      const backendId = backend.name;
      const profiles = await this.listModelsForBackend(backend.name);
      const options: BackendCatalogOption[] = profiles.length > 0
        ? profiles.map((profile) => ({
            kind: "profile",
            profileName: profile.name,
            model: profile.model,
            provider: profile.provider,
            label: `${backendId} - ${profile.name} (${profile.model})`,
            value: this.encodeSelectionValue(backendId, profile.model, profile.name),
            available: true,
            extras: profile.extras,
          }))
        : (backend.models ?? []).map((model) => ({
            kind: "model" as const,
            model,
            label: `${backendId} - ${model}`,
            value: this.encodeSelectionValue(backendId, model),
            available: true,
          }));
      if (options.length === 0) continue;
      backends.push({
        backendId,
        description: backend.description,
        options,
      });
    }

    if (backends.length === 0) {
      throw new Error("no backend catalog options available");
    }

    const defaultSelection = this.resolveDefaultSelection(backends, session);
    return { backends, defaultSelection };
  }

  parseSelectionValue(value: string): { backendId: BackendId; model: string; profileName?: string } {
    const raw = String(value ?? "").trim();
    const firstColon = raw.indexOf(":");
    if (firstColon < 0) {
      throw new Error(`invalid backend selection value: ${raw}`);
    }
    const backendRaw = raw.slice(0, firstColon);
    if (!isBackendId(backendRaw)) {
      throw new Error(`invalid backend selection backend: ${backendRaw}`);
    }
    const rest = raw.slice(firstColon + 1);
    const secondColon = rest.indexOf(":");
    if (secondColon < 0) {
      throw new Error(`invalid backend selection payload: ${raw}`);
    }
    const profileName = rest.slice(0, secondColon);
    const model = rest.slice(secondColon + 1).trim();
    if (!model) {
      throw new Error(`invalid backend selection model: ${raw}`);
    }
    return {
      backendId: backendRaw,
      model,
      profileName: profileName ? profileName : undefined,
    };
  }

  async resolveSession(projectId: string, threadName?: string): Promise<ResolvedBackendSession> {
    return this.backendSessionResolver.resolve(projectId, threadName);
  }

  async readBackendConfigs(): Promise<BackendConfigInfo[]> {
    return this.backendConfigService.readAllConfigs();
  }

  async adminAddProvider(backendName: string, providerName: string, baseUrl?: string, apiKeyEnv?: string, context?: Record<string, unknown>): Promise<void> {
    this.log.info({ backendId: backendName, providerName, baseUrl, apiKeyEnv, ...context }, "adminAddProvider");
    this.backendConfigService.addProvider(backendName, providerName, baseUrl, apiKeyEnv);
    await this.reSyncRegistry();
  }

  async adminRemoveProvider(backendName: string, providerName: string): Promise<void> {
    this.backendConfigService.removeProvider(backendName, providerName);
    await this.reSyncRegistry();
  }

  async adminAddModel(backendName: string, providerName: string, modelName: string, modelConfig?: Record<string, unknown>, context?: Record<string, unknown>): Promise<void> {
    this.log.info({ backendId: backendName, providerName, modelName, hasConfig: !!modelConfig, ...context }, "adminAddModel");
    this.backendConfigService.addModel(backendName, providerName, modelName, modelConfig);
    await this.reSyncRegistry();
    this.backendConfigService.validateModel(backendName, providerName, modelName)
      .then(() => this.reSyncRegistry())
      .catch(err => this.log.warn({ backendId: backendName, providerName, modelName, ...context, err: err instanceof Error ? err.message : err }, "fire-and-forget validate failed"));
  }

  async adminRemoveModel(backendName: string, providerName: string, modelName: string): Promise<void> {
    this.backendConfigService.removeModel(backendName, providerName, modelName);
    await this.reSyncRegistry();
  }

  adminWriteProfile(backendId: string, profileName: string, model: string, provider: string, extras?: Record<string, unknown>, context?: Record<string, unknown>): void {
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
    this.backendConfigService.deleteProfile(backendId, profileName);
  }

  async adminTriggerRecheck(backendName: string, providerName: string, context?: Record<string, unknown>): Promise<void> {
    this.log.info({ backendId: backendName, providerName, ...context }, "adminTriggerRecheck");
    this.backendConfigService.validateAllModels(backendName, providerName)
      .then(() => this.reSyncRegistry())
      .catch(err => this.log.warn({ backendId: backendName, providerName, ...context, err: err instanceof Error ? err.message : err }, "recheck failed"));
  }

  async readBackendPolicy(backendName: string): Promise<Record<string, string>> {
    return this.backendConfigService.readPolicy(backendName);
  }

  updateBackendPolicy(backendName: string, field: string, value: string, context?: Record<string, unknown>): void {
    this.log.info({ backendId: backendName, policyField: field, ...context }, "updateBackendPolicy");
    this.backendConfigService.updatePolicy(backendName, field, value);
  }

  async runHealthCheck(): Promise<void> {
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

  private encodeSelectionValue(backendId: BackendId, model: string, profileName?: string): string {
    return `${backendId}:${profileName ?? ""}:${model}`;
  }

  private resolveDefaultSelection(
    backends: BackendCatalogView["backends"],
    session: ResolvedBackendSession,
  ): BackendCatalogView["defaultSelection"] {
    const matchedProfile = backends
      .flatMap((backend) => backend.options.map((option) => ({ backend, option })))
      .find(({ backend, option }) =>
        backend.backendId === session.backend.backendId
        && option.kind === "profile"
        && option.model === session.backend.model);
    if (matchedProfile) {
      return {
        backendId: matchedProfile.backend.backendId,
        model: matchedProfile.option.model,
        profileName: matchedProfile.option.profileName,
        value: matchedProfile.option.value,
      };
    }

    const matchedModel = backends
      .flatMap((backend) => backend.options.map((option) => ({ backend, option })))
      .find(({ backend, option }) =>
        backend.backendId === session.backend.backendId
        && option.model === session.backend.model);
    if (matchedModel) {
      return {
        backendId: matchedModel.backend.backendId,
        model: matchedModel.option.model,
        profileName: matchedModel.option.profileName,
        value: matchedModel.option.value,
      };
    }

    const first = backends[0]?.options[0];
    const firstBackend = backends[0];
    if (!first || !firstBackend) return undefined;
    this.log.warn({
      sessionBackend: session.backend.backendId,
      sessionModel: session.backend.model,
      defaultBackend: firstBackend.backendId,
      defaultModel: first.model,
    }, "backend catalog default selection fell back to first option");
    return {
      backendId: firstBackend.backendId,
      model: first.model,
      profileName: first.profileName,
      value: first.value,
    };
  }
}
