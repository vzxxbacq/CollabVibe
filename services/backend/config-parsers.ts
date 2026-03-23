import type { ModelInfo, ProviderInfo } from "./config-service";

export function parseSimpleToml(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = { "": {} };
  let currentSection = "";

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }

    const kvMatch = trimmed.match(/^([^=]+?)\s*=\s*(.+)$/);
    if (kvMatch) {
      let key = kvMatch[1]!.trim();
      let value = kvMatch[2]!.trim();
      if ((key.startsWith("\"") && key.endsWith("\"")) || (key.startsWith("'") && key.endsWith("'"))) {
        key = key.slice(1, -1);
      }
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      result[currentSection]![key] = value;
    }
  }
  return result;
}

export function parseCodexConfigContent(params: {
  content: string;
  getExistingStatuses: (providerName: string) => ModelInfo[];
  envReader?: (name: string) => string | undefined;
}): {
  parsed: Record<string, Record<string, string>>;
  root: Record<string, string>;
  activeProvider?: string;
  policy?: Record<string, string>;
  providerMap: Map<string, ProviderInfo>;
} {
  const parsed = parseSimpleToml(params.content);
  const root = parsed[""] ?? {};
  const envReader = params.envReader ?? ((name: string) => process.env[name]);
  const policy: Record<string, string> = {};
  if (root.approval_policy) policy.approval_policy = root.approval_policy;
  if (root.sandbox_mode) policy.sandbox_mode = root.sandbox_mode;

  const providerMap = new Map<string, ProviderInfo>();
  for (const sectionKey of Object.keys(parsed)) {
    const providerMatch = sectionKey.match(/^model_providers\.(.+)$/);
    if (!providerMatch) continue;
    const providerName = providerMatch[1]!;
    const section = parsed[sectionKey]!;
    const apiKeyEnv = section.env_key;
    providerMap.set(providerName, {
      name: providerName,
      baseUrl: section.base_url,
      apiKeyEnv,
      apiKeySet: apiKeyEnv ? !!envReader(apiKeyEnv) : false,
      apiKey: section.api_key,
      isActive: providerName === root.model_provider,
      models: [],
      wireApi: section.wire_api,
    });
  }

  const currentModel = root.model;
  const currentModelReasoningEffort = root.model_reasoning_effort;
  const currentPersonality = root.personality;
  let hasProfiles = false;

  for (const sectionKey of Object.keys(parsed)) {
    const profileMatch = sectionKey.match(/^profiles\.(.+)$/);
    if (!profileMatch) continue;
    hasProfiles = true;
    const profileName = profileMatch[1]!;
    const section = parsed[sectionKey]!;
    const { model, model_provider, ...extras } = section;
    const modelId = model ?? currentModel ?? "";
    const providerName = model_provider ?? root.model_provider ?? "";
    const provider = providerMap.get(providerName);
    if (!provider) continue;
    const statusMap = new Map(params.getExistingStatuses(providerName).map((m) => [m.name, m]));
    const existing = statusMap.get(profileName);
    provider.models.push({
      name: profileName,
      modelId,
      available: existing?.available ?? null,
      checkedAt: existing?.checkedAt,
      isCurrent: profileName === currentModel || modelId === currentModel,
      extras: extras as Record<string, unknown>,
    });
  }

  if (!hasProfiles && currentModel) {
    const providerName = root.model_provider ?? "";
    const provider = providerMap.get(providerName);
    if (provider) {
      const statusMap = new Map(params.getExistingStatuses(providerName).map((m) => [m.name, m]));
      const existing = statusMap.get(currentModel);
      const extras: Record<string, unknown> = {};
      if (currentModelReasoningEffort) extras.model_reasoning_effort = currentModelReasoningEffort;
      if (currentPersonality) extras.personality = currentPersonality;
      provider.models.push({
        name: currentModel,
        modelId: currentModel,
        available: existing?.available ?? null,
        checkedAt: existing?.checkedAt,
        isCurrent: true,
        extras,
      });
    }
  }

  return {
    parsed,
    root,
    activeProvider: root.model_provider,
    policy: Object.keys(policy).length > 0 ? policy : undefined,
    providerMap,
  };
}

export function parseClaudeConfigContent(params: {
  content: string;
  getExistingStatuses: (providerName: string) => ModelInfo[];
  envReader?: (name: string) => string | undefined;
}): {
  activeProvider: string;
  providers: ProviderInfo[];
} {
  const parsed = JSON.parse(params.content);
  const currentModel = parsed.model;
  const apiKeyEnv = "ANTHROPIC_API_KEY";
  const envReader = params.envReader ?? ((name: string) => process.env[name]);
  const existingModels = params.getExistingStatuses("anthropic");
  const models: ModelInfo[] = currentModel
    ? [existingModels.find((m) => m.name === currentModel) ?? {
      name: currentModel, modelId: currentModel, available: null, isCurrent: true, extras: {}
    }]
    : [];

  return {
    activeProvider: "anthropic",
    providers: [{
      name: "anthropic",
      baseUrl: "https://api.anthropic.com",
      apiKeyEnv,
      apiKeySet: !!envReader(apiKeyEnv),
      isActive: true,
      models
    }]
  };
}

export function parseOpenCodeConfigContent(params: {
  content: string;
  getExistingStatuses: (providerName: string) => ModelInfo[];
  resolveApiKey: (name?: string) => string | undefined;
}): {
  parsed: any;
  policy?: Record<string, string>;
  providers: ProviderInfo[];
} {
  const parsed = JSON.parse(params.content);
  let policy: Record<string, string> | undefined;
  const permissionVal = parsed.permission;
  if (permissionVal !== undefined) {
    policy = {};
    if (typeof permissionVal === "string") {
      policy.permission = permissionVal;
    } else if (permissionVal && typeof permissionVal === "object") {
      const permissionQuestion = (permissionVal as Record<string, unknown>).question;
      if (typeof permissionQuestion === "string") {
        policy.permission_question = permissionQuestion;
      }
    }
  }

  const providers: ProviderInfo[] = [];
  const providerDefs = parsed.provider ?? {};
  for (const [providerName, providerDef] of Object.entries(providerDefs) as [string, any][]) {
    const options = providerDef?.options ?? {};
    const modelsObj = providerDef?.models ?? {};
    const existingModels = params.getExistingStatuses(providerName);
    const statusMap = new Map(existingModels.map((s) => [s.name, s]));
    const models: ModelInfo[] = Object.entries(modelsObj).map(([jsonKey, modelDef]: [string, any]) => {
      const displayName = modelDef?.name ?? jsonKey;
      const existing = statusMap.get(displayName) ?? statusMap.get(jsonKey);
      const modelExtras: Record<string, unknown> = {};
      if (modelDef?.options) modelExtras.options = modelDef.options;
      if (modelDef?.limit) modelExtras.limit = modelDef.limit;
      if (modelDef?.modalities) modelExtras.modalities = modelDef.modalities;
      return {
        name: displayName,
        modelId: jsonKey,
        available: existing?.available ?? null,
        checkedAt: existing?.checkedAt,
        isCurrent: false,
        extras: modelExtras,
      };
    });

    let apiKeyEnv: string | undefined;
    let apiKey: string | undefined;
    const rawKey: string = options.apiKey ?? "";
    if (rawKey.startsWith("$")) {
      apiKeyEnv = rawKey.slice(1);
    } else if (rawKey) {
      apiKeyEnv = rawKey;
      apiKey = rawKey;
    }

    providers.push({
      name: providerName,
      baseUrl: options.baseURL,
      apiKeyEnv,
      apiKey,
      apiKeySet: !!params.resolveApiKey(apiKeyEnv),
      isActive: false,
      models,
    });
  }

  return { parsed, policy, providers };
}
