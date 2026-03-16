import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createLogger } from "../../../../packages/channel-core/src/index";
import type {
    UnifiedProviderInput, UnifiedProfileInput,
    StoredProvider, StoredProfile, CodexServerCmdResult
} from "../../../../packages/agent-core/src/backend-config-types";

const log = createLogger("backend-config");

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * ModelInfo — profile-derived model entry.
 * Each profile IS a model from the user’s perspective.
 * e.g. name="5.4-high", modelId="gpt-5.4", extras={model_reasoning_effort:"high"}
 */
export interface ModelInfo {
    /** Profile name (user-visible model name) */
    name: string;
    /** Raw underlying model ID */
    modelId: string;
    available: boolean | null;   // null = not checked
    checkedAt?: string;          // ISO timestamp
    error?: string;
    isCurrent: boolean;
    /** Backend-specific extras (reasoning_effort, personality, thinking, modalities, etc.) */
    extras: Record<string, unknown>;
}

/** @deprecated Use ModelInfo instead */
export type ModelStatus = ModelInfo;

export interface ProviderInfo {
    name: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    apiKeySet: boolean;
    /** Internal: resolved API key for deploy. NOT serialized to IM layer. */
    apiKey?: string;
    isActive: boolean;
    models: ModelInfo[];
    /** Internal: wire API type (codex only) */
    wireApi?: string;
}

export interface BackendConfigInfo {
    name: string;
    serverCmd: string;
    transport: "codex" | "acp";
    cmdAvailable: boolean;
    localConfigPath: string;
    sourceConfigPath: string;
    configExists: boolean;
    activeProvider?: string;
    providers: ProviderInfo[];
    /** Environment variables to pass to the backend process */
    env?: Record<string, string>;
    /** Policy fields read from the backend's config file */
    policy?: Record<string, string>;
    /** Deploy config to project worktree for this backend */
    deploy(cwd: string, modelName: string): void;
    /** Build server command with config flags (codex: -c injection; others: noop) */
    buildServerCmd(modelName: string, cwd?: string): CodexServerCmdResult;
}

// ── Simple TOML parser ──────────────────────────────────────────────────────

function parseSimpleToml(content: string): Record<string, Record<string, string>> {
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
            // Remove quotes from both key and value
            if ((key.startsWith('"') && key.endsWith('"')) ||
                (key.startsWith("'") && key.endsWith("'"))) {
                key = key.slice(1, -1);
            }
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            result[currentSection]![key] = value;
        }
    }
    return result;
}

// ── Config source mapping ────────────────────────────────────────────────────

interface ConfigSource {
    name: string;
    serverCmd: string;
    transport: "codex" | "acp";
    localFile: string;
    sourceFile: string;
}

const CONFIG_SOURCES: ConfigSource[] = [
    {
        name: "codex",
        serverCmd: "codex app-server",
        transport: "codex",
        localFile: "codex.toml",
        sourceFile: join(homedir(), ".codex", "config.toml")
    },
    {
        name: "claude-code",
        serverCmd: "claude --acp",
        transport: "acp",
        localFile: "claude.json",
        sourceFile: join(homedir(), ".claude", "settings.json")
    },
    {
        name: "opencode",
        serverCmd: "opencode acp --log-level DEBUG --print-logs",
        transport: "acp",
        localFile: "opencode.json",
        sourceFile: join(homedir(), ".config", "opencode", "opencode.json")
    }
];

// ── BackendConfigService ─────────────────────────────────────────────────────

import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFileCb);

async function checkCmd(cmd: string): Promise<boolean> {
    try {
        await execFileAsync("which", [cmd]);
        return true;
    } catch {
        return false;
    }
}

export class BackendConfigService {
    private readonly configDir: string;
    private modelStatuses: Map<string, Map<string, ModelStatus[]>> = new Map();
    private dynamicProviders: Map<string, Array<{ name: string; baseUrl?: string; apiKeyEnv?: string }>> = new Map();

    constructor(configDir: string = "data/config") {
        this.configDir = configDir;
    }

    /** Startup: ensure data/config/ exists and copy missing configs from home */
    ensureLocalConfigs(): void {
        if (!existsSync(this.configDir)) {
            mkdirSync(this.configDir, { recursive: true });
            log.info({ dir: this.configDir }, "created config directory");
        }

        for (const source of CONFIG_SOURCES) {
            const localPath = join(this.configDir, source.localFile);
            if (!existsSync(localPath) && existsSync(source.sourceFile)) {
                try {
                    copyFileSync(source.sourceFile, localPath);
                    log.info({ from: source.sourceFile, to: localPath }, "copied config from home");
                } catch (err) {
                    log.warn({ from: source.sourceFile, err: err instanceof Error ? err.message : err }, "failed to copy config");
                }
            }
        }
    }

    /** Read all backend configs */
    async readAllConfigs(): Promise<BackendConfigInfo[]> {
        const configs = await Promise.all([
            this.readCodexConfig(),
            this.readClaudeConfig(),
            this.readOpencodeConfig()
        ]);
        // Merge dynamic providers into each backend
        for (const config of configs) {
            const dynamic = this.dynamicProviders.get(config.name) ?? [];
            for (const dp of dynamic) {
                if (config.providers.some((p) => p.name === dp.name)) continue;
                config.providers.push({
                    name: dp.name,
                    baseUrl: dp.baseUrl,
                    apiKeyEnv: dp.apiKeyEnv,
                    apiKeySet: dp.apiKeyEnv ? !!process.env[dp.apiKeyEnv] : false,
                    isActive: false,
                    models: this.getModelStatuses(config.name, dp.name)
                });
            }
        }
        return configs;
    }

    /** Read codex config from data/config/codex.toml */
    async readCodexConfig(): Promise<BackendConfigInfo> {
        const source = CONFIG_SOURCES[0]!;
        const localPath = join(this.configDir, source.localFile);

        const noopDeploy = () => { };
        const noopBuildCmd = (): CodexServerCmdResult => ({ serverCmd: source.serverCmd, env: {} });

        const info: BackendConfigInfo = {
            name: source.name,
            serverCmd: source.serverCmd,
            transport: source.transport,
            cmdAvailable: await checkCmd(source.serverCmd.split(/\s+/)[0] ?? source.serverCmd),
            localConfigPath: localPath,
            sourceConfigPath: source.sourceFile,
            configExists: existsSync(localPath),
            providers: [],
            deploy: noopDeploy,
            buildServerCmd: noopBuildCmd,
        };

        if (!info.configExists) return info;

        try {
            const content = readFileSync(localPath, "utf-8");
            const parsed = parseSimpleToml(content);
            const root = parsed[""] ?? {};

            info.activeProvider = root.model_provider;
            const currentModel = root.model;
            const currentModelReasoningEffort = root.model_reasoning_effort;
            const currentPersonality = root.personality;

            // Read policy fields
            info.policy = {};
            if (root.approval_policy) info.policy.approval_policy = root.approval_policy;
            if (root.sandbox_mode) info.policy.sandbox_mode = root.sandbox_mode;

            // ── Parse providers ──────────────────────────────────────────
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
                    apiKeySet: apiKeyEnv ? !!process.env[apiKeyEnv] : false,
                    apiKey: section.api_key,
                    isActive: providerName === root.model_provider,
                    models: [],
                    wireApi: section.wire_api,
                });
            }

            // ── Parse profiles → ModelInfo, assign to provider ───────────
            const existingStatuses = (providerName: string) => {
                const s = this.getModelStatuses(source.name, providerName);
                return new Map(s.map((m) => [m.name, m]));
            };

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

                const statusMap = existingStatuses(providerName);
                const existing = statusMap.get(profileName);

                const modelInfo: ModelInfo = {
                    name: profileName,
                    modelId,
                    available: existing?.available ?? null,
                    checkedAt: existing?.checkedAt,
                    isCurrent: profileName === currentModel || modelId === currentModel,
                    extras: extras as Record<string, unknown>,
                };
                provider.models.push(modelInfo);
            }

            // If no profiles exist but root model is set → auto-generate default
            if (!hasProfiles && currentModel) {
                const providerName = root.model_provider ?? "";
                const provider = providerMap.get(providerName);
                if (provider) {
                    const statusMap = existingStatuses(providerName);
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

            // Commit providers + update model status cache
            for (const [providerName, provider] of providerMap) {
                info.providers.push(provider);
                this.setModelStatuses(source.name, providerName, provider.models);
            }

            // ── Attach deploy + buildServerCmd ───────────────────────────
            info.deploy = (cwd: string, modelName: string) => {
                this._deployCodex(localPath, cwd, modelName, parsed, root, providerMap);
            };
            info.buildServerCmd = (modelName: string, cwd?: string) => {
                return this._buildCodexServerCmd(localPath, modelName, cwd, providerMap);
            };
        } catch (err) {
            log.warn({ path: localPath, err: err instanceof Error ? err.message : err }, "failed to parse codex config");
        }

        return info;
    }

    /** Read claude config from data/config/claude.json */
    async readClaudeConfig(): Promise<BackendConfigInfo> {
        const source = CONFIG_SOURCES[1]!;
        const localPath = join(this.configDir, source.localFile);

        const noopDeploy = () => { };
        const noopBuildCmd = (): CodexServerCmdResult => ({ serverCmd: source.serverCmd, env: {} });

        const info: BackendConfigInfo = {
            name: source.name,
            serverCmd: source.serverCmd,
            transport: source.transport,
            cmdAvailable: await checkCmd(source.serverCmd.split(/\s+/)[0] ?? source.serverCmd),
            localConfigPath: localPath,
            sourceConfigPath: source.sourceFile,
            configExists: existsSync(localPath),
            providers: [],
            deploy: noopDeploy,
            buildServerCmd: noopBuildCmd,
        };

        if (!info.configExists) return info;

        try {
            const content = readFileSync(localPath, "utf-8");
            const parsed = JSON.parse(content);
            const currentModel = parsed.model;

            const apiKeyEnv = "ANTHROPIC_API_KEY";
            const existingModels = this.getModelStatuses(source.name, "anthropic");
            const models: ModelInfo[] = currentModel
                ? [existingModels.find((m) => m.name === currentModel) ?? {
                    name: currentModel, modelId: currentModel,
                    available: null, isCurrent: true, extras: {}
                }]
                : [];

            info.activeProvider = "anthropic";
            info.providers.push({
                name: "anthropic",
                baseUrl: "https://api.anthropic.com",
                apiKeyEnv,
                apiKeySet: !!process.env[apiKeyEnv],
                isActive: true,
                models
            });
            this.setModelStatuses(source.name, "anthropic", models);

            // Attach deploy (writes .claude/settings.json)
            info.deploy = (cwd: string, modelName: string) => {
                this._deployClaude(cwd, modelName, info.providers);
            };
        } catch (err) {
            log.warn({ path: localPath, err: err instanceof Error ? err.message : err }, "failed to parse claude config");
        }

        return info;
    }

    /** Read opencode config from data/config/opencode.json */
    async readOpencodeConfig(): Promise<BackendConfigInfo> {
        const source = CONFIG_SOURCES[2]!;
        const localPath = join(this.configDir, source.localFile);

        const noopDeploy = () => { };
        const noopBuildCmd = (): CodexServerCmdResult => ({ serverCmd: source.serverCmd, env: {} });

        const info: BackendConfigInfo = {
            name: source.name,
            serverCmd: source.serverCmd,
            transport: source.transport,
            cmdAvailable: await checkCmd(source.serverCmd.split(/\s+/)[0] ?? source.serverCmd),
            localConfigPath: localPath,
            sourceConfigPath: source.sourceFile,
            configExists: existsSync(localPath),
            providers: [],
            env: { OPENCODE_CONFIG: localPath },
            deploy: noopDeploy,
            buildServerCmd: noopBuildCmd,
        };

        if (!info.configExists) return info;

        try {
            const content = readFileSync(localPath, "utf-8");
            const parsed = JSON.parse(content);

            // Read policy fields
            const permissionVal = parsed.permission;
            if (permissionVal !== undefined) {
                info.policy = {};
                if (typeof permissionVal === "string") {
                    info.policy.permission = permissionVal;
                } else if (permissionVal && typeof permissionVal === "object") {
                    const permissionQuestion = (permissionVal as Record<string, unknown>).question;
                    if (typeof permissionQuestion === "string") {
                        info.policy.permission_question = permissionQuestion;
                    }
                }
            }

            const providers = parsed.provider ?? {};
            for (const [providerName, providerDef] of Object.entries(providers) as [string, any][]) {
                const options = providerDef?.options ?? {};
                const modelsObj = providerDef?.models ?? {};

                const existingModels = this.getModelStatuses(source.name, providerName);
                const statusMap = new Map(existingModels.map((s) => [s.name, s]));

                // Each model entry = ModelInfo with extras from config
                const models: ModelInfo[] = Object.entries(modelsObj).map(([jsonKey, modelDef]: [string, any]) => {
                    const displayName = modelDef?.name ?? jsonKey;
                    // statusMap key is display name (how validateModel stores it)
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

                // Detect apiKey: $ENV_VAR or literal
                let apiKeyEnv: string | undefined;
                let apiKey: string | undefined;
                const rawKey: string = options.apiKey ?? "";
                if (rawKey.startsWith("$")) {
                    apiKeyEnv = rawKey.slice(1);
                } else if (rawKey) {
                    apiKeyEnv = rawKey;
                    apiKey = rawKey;
                }

                info.providers.push({
                    name: providerName,
                    baseUrl: options.baseURL,
                    apiKeyEnv,
                    apiKey,
                    apiKeySet: !!this.resolveApiKey(apiKeyEnv),
                    isActive: false,
                    models
                });
                this.setModelStatuses(source.name, providerName, models);
            }

            // Attach deploy (writes .opencode/config.json)
            info.deploy = (cwd: string, modelName: string) => {
                this._deployOpenCode(cwd, modelName, parsed, info.providers);
            };
        } catch (err) {
            log.warn({ path: localPath, err: err instanceof Error ? err.message : err }, "failed to parse opencode config");
        }

        return info;
    }

    /** Validate a model against a provider's API */
    async validateModel(backendName: string, providerName: string, modelName: string): Promise<ModelStatus> {
        // Find the provider to get baseUrl and apiKey
        const configs = await this.readAllConfigs();
        const backend = configs.find((c) => c.name === backendName);
        const provider = backend?.providers.find((p) => p.name === providerName);

        if (!provider) {
            return { name: modelName, modelId: modelName, available: false, checkedAt: new Date().toISOString(), error: "接入源不存在", isCurrent: false, extras: {} };
        }

        // Resolve the actual model ID from ModelInfo (profileName → modelId)
        // e.g., modelName="5.3-codex-high" → modelId="gpt-5.3-codex"
        const modelInfo = provider.models.find(m => m.name === modelName);
        const actualModelId = modelInfo?.modelId ?? modelName;

        const baseUrl = provider.baseUrl;
        const apiKey = this.resolveApiKey(provider.apiKeyEnv) ?? provider.apiKey;

        if (!baseUrl || !apiKey) {
            const status: ModelStatus = {
                name: modelName, modelId: actualModelId,
                available: false,
                checkedAt: new Date().toISOString(),
                error: !baseUrl ? "No base_url" : "API key not set",
                isCurrent: false, extras: modelInfo?.extras ?? {}
            };
            this.updateModelStatus(backendName, providerName, status);
            return status;
        }

        try {
            const baseUrlClean = baseUrl.replace(/\/+$/, "");
            const endpoints = [
                { url: `${baseUrlClean}/messages`, body: { model: actualModelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1 }, extraHeaders: { "anthropic-version": "2023-06-01" } },
                { url: `${baseUrlClean}/chat/completions`, body: { model: actualModelId, messages: [{ role: "user", content: "hi" }], max_tokens: 1 } },
                { url: `${baseUrlClean}/responses`, body: { model: actualModelId, input: "hi", max_output_tokens: 1 } },
            ];

            let lastStatus = 0;
            for (const ep of endpoints) {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10_000);
                try {
                    const response = await fetch(ep.url, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${apiKey}`,
                            ...(ep as any).extraHeaders
                        },
                        body: JSON.stringify(ep.body),
                        signal: controller.signal
                    });
                    clearTimeout(timeout);
                    lastStatus = response.status;
                    log.info({ url: ep.url, status: response.status, modelName, backendId: backendName, providerName }, "validate endpoint probe");

                    if (response.ok || (response.status >= 400 && response.status < 404)) {
                        const status: ModelStatus = {
                            name: modelName, modelId: actualModelId,
                            available: response.ok,
                            checkedAt: new Date().toISOString(),
                            error: response.ok ? undefined : `HTTP ${response.status}`,
                            isCurrent: false, extras: modelInfo?.extras ?? {}
                        };
                        this.updateModelStatus(backendName, providerName, status);
                        return status;
                    }
                    // 404+ = endpoint doesn't exist, try next
                } catch (err) {
                    clearTimeout(timeout);
                    log.warn({ url: ep.url, modelName, backendId: backendName, providerName, err: err instanceof Error ? err.message : err }, "validate endpoint error");
                }
            }

            // All endpoints failed
            const status: ModelStatus = {
                name: modelName, modelId: actualModelId,
                available: false,
                checkedAt: new Date().toISOString(),
                error: `HTTP ${lastStatus || "timeout"}`,
                isCurrent: false, extras: modelInfo?.extras ?? {}
            };
            this.updateModelStatus(backendName, providerName, status);
            return status;
        } catch (err) {
            const status: ModelStatus = {
                name: modelName, modelId: actualModelId,
                available: false,
                checkedAt: new Date().toISOString(),
                error: err instanceof Error ? err.message : String(err),
                isCurrent: false, extras: modelInfo?.extras ?? {}
            };
            this.updateModelStatus(backendName, providerName, status);
            return status;
        }
    }

    /** Validate all models for a specific provider */
    async validateAllModels(backendName: string, providerName: string): Promise<ModelStatus[]> {
        // Ensure model statuses are loaded from config files first
        await this.readAllConfigs();
        const models = this.getModelStatuses(backendName, providerName);
        log.info({ backendId: backendName, providerName, modelCount: models.length }, "validateAllModels");
        return Promise.all(models.map((m) => this.validateModel(backendName, providerName, m.name)));
    }

    /** Backward-compatible provider add */
    addProvider(backendName: string, providerName: string, baseUrl?: string, apiKeyEnv?: string): void {
        // Initialize the provider's model list so it shows up in readAllConfigs
        this.setModelStatuses(backendName, providerName, []);
        // Store provider metadata for dynamic providers
        if (!this.dynamicProviders.has(backendName)) this.dynamicProviders.set(backendName, []);
        this.dynamicProviders.get(backendName)!.push({ name: providerName, baseUrl, apiKeyEnv });
        log.info({ backendId: backendName, providerName, baseUrl, apiKeyEnv }, "added backend source");

        // Persist to config file
        this.persistProvider(backendName, providerName, baseUrl, apiKeyEnv);
    }

    /**
     * Resolve apiKeyEnv to actual key value:
     * - ALL_CAPS_UNDERSCORES → treat as env var name, read from process.env
     * - Otherwise → treat as literal key value
     */
    private resolveApiKey(apiKeyEnv?: string): string | undefined {
        if (!apiKeyEnv) return undefined;
        if (/^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv)) {
            return process.env[apiKeyEnv];
        }
        return apiKeyEnv;
    }

    /** Write provider config to the backend's config file */
    private persistProvider(backendName: string, providerName: string, baseUrl?: string, apiKeyEnv?: string): void {
        try {
            const source = CONFIG_SOURCES.find(s => s.name === backendName);
            if (!source) return;
            const localPath = join(this.configDir, source.localFile);

            if (backendName === "codex") {
                // Codex TOML: apiKeyEnv is the actual key value (sk-xxx), env_key auto-generated
                this.writeProviderCodex(localPath, {
                    name: providerName,
                    baseUrl: baseUrl ?? "",
                    apiKey: apiKeyEnv ?? "",
                });
            } else if (backendName === "opencode") {
                let config: any = {};
                if (existsSync(localPath)) {
                    config = JSON.parse(readFileSync(localPath, "utf-8"));
                }
                if (!config.provider) config.provider = {};
                const keyValue = apiKeyEnv && /^[A-Z][A-Z0-9_]*$/.test(apiKeyEnv) ? `$${apiKeyEnv}` : (apiKeyEnv ?? "");
                config.provider[providerName] = {
                    options: {
                        baseURL: baseUrl ?? "",
                        apiKey: keyValue
                    },
                    models: {}
                };
                const { writeFileSync: wfs } = require("node:fs");
                wfs(localPath, JSON.stringify(config, null, 2), "utf-8");
                log.info({ backendId: backendName, configPath: localPath }, "persisted backend source to config");
            }
        } catch (err) {
            log.warn({ backendId: backendName, err: err instanceof Error ? err.message : err }, "failed to persist backend source config");
        }
    }

    /** Get the absolute path to a backend's local config file */
    getConfigPath(backendName: string): string | undefined {
        const source = CONFIG_SOURCES.find(s => s.name === backendName);
        if (!source) return undefined;
        const { resolve } = require("node:path");
        return resolve(this.configDir, source.localFile);
    }

    /** Add a model to a provider. Persists to TOML (codex) or JSON (opencode) config file. */
    addModel(backendName: string, providerName: string, modelName: string, modelConfig?: Record<string, unknown>): void {
        // Add to in-memory model statuses
        const existing = this.getModelStatuses(backendName, providerName);
        if (!existing.find(m => m.name === modelName)) {
            existing.push({ name: modelName, modelId: modelName, available: null, isCurrent: false, extras: modelConfig ?? {} });
            this.setModelStatuses(backendName, providerName, existing);
        }

        // Persist to TOML profile (codex) so readCodexConfig can find it
        if (backendName === "codex") {
            try {
                this.writeProfile(backendName, {
                    name: modelName,
                    model: modelName,
                    provider: providerName,
                    extras: modelConfig ?? {},
                });
            } catch (err) {
                log.warn({ backendId: backendName, modelName, err: err instanceof Error ? err.message : err }, "failed to persist codex model as profile");
            }
        }

        // Persist to config file (opencode) — write into provider[name].models[modelId]
        if (backendName === "opencode") {
            try {
                const source = CONFIG_SOURCES.find(s => s.name === backendName);
                if (!source) return;
                const localPath = join(this.configDir, source.localFile);
                let config: any = {};
                if (existsSync(localPath)) {
                    config = JSON.parse(readFileSync(localPath, "utf-8"));
                }
                const provider = config.provider?.[providerName];
                if (provider) {
                    if (!provider.models) provider.models = {};
                    // modelName is the model ID (JSON key)
                    const modelEntry: any = { name: modelName };
                    // Carry over extras as opencode schema fields
                    if (modelConfig?.thinking_budget_tokens) {
                        modelEntry.options = { thinking: { type: "enabled", budgetTokens: Number(modelConfig.thinking_budget_tokens) } };
                    }
                    if (modelConfig?.context_limit || modelConfig?.output_limit) {
                        modelEntry.limit = {};
                        if (modelConfig.context_limit) modelEntry.limit.context = Number(modelConfig.context_limit);
                        if (modelConfig.output_limit) modelEntry.limit.output = Number(modelConfig.output_limit);
                    }
                    modelEntry.modalities = { input: ["text"], output: ["text"] };
                    provider.models[modelName] = modelEntry;
                    const { writeFileSync } = require("node:fs");
                    writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
                    log.info({ backendId: backendName, providerName, modelName, hasConfig: !!modelConfig }, "persisted model to config");
                }
            } catch (err) {
                log.warn({ backendId: backendName, providerName, err: err instanceof Error ? err.message : err }, "failed to persist model config");
            }
        }
    }

    /** Remove a provider from a backend (in-memory + persist) */
    removeProvider(backendName: string, providerName: string): void {
        // Remove model statuses
        this.modelStatuses.get(backendName)?.delete(providerName);
        // Remove from dynamic providers
        const dynamicList = this.dynamicProviders.get(backendName);
        if (dynamicList) {
            const idx = dynamicList.findIndex(p => p.name === providerName);
            if (idx >= 0) dynamicList.splice(idx, 1);
        }
        // Persist removal: codex — delete TOML [model_providers.X] and associated profiles
        if (backendName === "codex") {
            try {
                const source = CONFIG_SOURCES.find(s => s.name === backendName);
                if (!source) return;
                const localPath = join(this.configDir, source.localFile);
                if (existsSync(localPath)) {
                    let content = readFileSync(localPath, "utf-8");
                    // Remove [model_providers.providerName] section
                    content = this.removeTomlSection(content, `model_providers.${providerName}`);
                    // Remove all profiles referencing this provider
                    const parsed = parseSimpleToml(content);
                    for (const sectionKey of Object.keys(parsed)) {
                        const profileMatch = sectionKey.match(/^profiles\.(.+)$/);
                        if (!profileMatch) continue;
                        const section = parsed[sectionKey]!;
                        if (section.model_provider === providerName) {
                            content = this.removeTomlSection(content, sectionKey);
                        }
                    }
                    writeFileSync(localPath, content, "utf-8");
                }
            } catch (err) {
                log.warn({ backendId: backendName, providerName, err: err instanceof Error ? err.message : err }, "failed to persist codex source removal");
            }
        }
        // Persist removal: opencode — delete from JSON
        if (backendName === "opencode") {
            try {
                const source = CONFIG_SOURCES.find(s => s.name === backendName);
                if (!source) return;
                const localPath = join(this.configDir, source.localFile);
                if (existsSync(localPath)) {
                    const config = JSON.parse(readFileSync(localPath, "utf-8"));
                    if (config.provider?.[providerName]) {
                        delete config.provider[providerName];
                        const { writeFileSync: wfs } = require("node:fs");
                        wfs(localPath, JSON.stringify(config, null, 2), "utf-8");
                    }
                }
            } catch (err) {
                log.warn({ backendId: backendName, providerName, err: err instanceof Error ? err.message : err }, "failed to persist source removal");
            }
        }
        log.info({ backendId: backendName, providerName }, "removed backend source");
    }

    /** Remove a model from a provider (in-memory + persist to TOML/JSON) */
    removeModel(backendName: string, providerName: string, modelName: string): void {
        // Remove from in-memory model statuses (capture modelId before splice for persistence)
        const models = this.getModelStatuses(backendName, providerName);
        const idx = models.findIndex(m => m.name === modelName);
        const removedModelId = idx >= 0 ? (models[idx]!.modelId ?? modelName) : modelName;
        if (idx >= 0) {
            models.splice(idx, 1);
            this.setModelStatuses(backendName, providerName, models);
        }
        // Persist removal: codex — delete TOML profile section
        if (backendName === "codex") {
            try {
                this.deleteProfile(backendName, modelName);
            } catch (err) {
                log.warn({ backendId: backendName, modelName, err: err instanceof Error ? err.message : err }, "failed to delete codex profile");
            }
        }
        // Persist removal: opencode — delete from JSON models
        // modelName is the display name (e.g. "GLM-5"), JSON key is modelId (e.g. "glm-5")
        if (backendName === "opencode") {
            try {

                const source = CONFIG_SOURCES.find(s => s.name === backendName);
                if (!source) return;
                const localPath = join(this.configDir, source.localFile);
                if (existsSync(localPath)) {
                    const config = JSON.parse(readFileSync(localPath, "utf-8"));
                    const provider = config.provider?.[providerName];
                    if (provider?.models?.[removedModelId]) {
                        delete provider.models[removedModelId];
                        const { writeFileSync } = require("node:fs");
                        writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
                        log.info({ backendId: backendName, providerName, modelName, removedModelId }, "persisted opencode model removal");
                    }
                }
            } catch (err) {
                log.warn({ backendId: backendName, providerName, modelName, err: err instanceof Error ? err.message : err }, "failed to persist model removal");
            }
        }
        log.info({ backendId: backendName, providerName, modelName }, "removed model");
    }

    /** Get all available model names for a backend (all providers combined) */
    getAvailableModelNames(backendName: string): string[] {
        const backendMap = this.modelStatuses.get(backendName);
        if (!backendMap) return [];
        const names: string[] = [];
        for (const models of backendMap.values()) {
            for (const m of models) names.push(m.name);
        }
        return names;
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private getModelStatuses(backend: string, provider: string): ModelStatus[] {
        return this.modelStatuses.get(backend)?.get(provider) ?? [];
    }

    private setModelStatuses(backend: string, provider: string, models: ModelStatus[]): void {
        if (!this.modelStatuses.has(backend)) this.modelStatuses.set(backend, new Map());
        this.modelStatuses.get(backend)!.set(provider, models);
    }

    private updateModelStatus(backend: string, provider: string, status: ModelStatus): void {
        const models = this.getModelStatuses(backend, provider);
        const idx = models.findIndex((m) => m.name === status.name);
        if (idx >= 0) {
            models[idx] = { ...status, isCurrent: models[idx]!.isCurrent };
        } else {
            models.push(status);
        }
        this.setModelStatuses(backend, provider, models);
    }

    // ── Policy read / write ──────────────────────────────────────────────

    /** Read policy fields from a backend's config file */
    async readPolicy(backendName: string): Promise<Record<string, string>> {
        const configs = await this.readAllConfigs();
        const backend = configs.find(c => c.name === backendName);
        return backend?.policy ?? {};
    }

    /** Update a policy field in a backend's config file */
    updatePolicy(backendName: string, field: string, value: string): void {
        const source = CONFIG_SOURCES.find(s => s.name === backendName);
        if (!source) {
            log.warn({ backendId: backendName }, "updatePolicy: unknown backend");
            return;
        }
        const localPath = join(this.configDir, source.localFile);

        try {
            if (backendName === "codex") {
                // TOML: read file, replace or insert root-level key
                let content = existsSync(localPath) ? readFileSync(localPath, "utf-8") : "";
                const regex = new RegExp(`^${field}\\s*=\\s*.*$`, "m");
                const newLine = `${field} = "${value}"`;
                if (regex.test(content)) {
                    content = content.replace(regex, newLine);
                } else {
                    // Insert at top of file (before first section)
                    const firstSection = content.indexOf("[");
                    if (firstSection > 0) {
                        content = content.slice(0, firstSection) + newLine + "\n" + content.slice(firstSection);
                    } else {
                        content = newLine + "\n" + content;
                    }
                }
                writeFileSync(localPath, content, "utf-8");
                log.info({ backendId: backendName, policyField: field, value, configPath: localPath }, "updated codex policy");
            } else if (backendName === "opencode") {
                // JSON: read, set field, write
                let config: any = {};
                if (existsSync(localPath)) {
                    config = JSON.parse(readFileSync(localPath, "utf-8"));
                }
                if (field === "permission") {
                    config.permission = value;
                }
                if (field === "permission_question") {
                    const permission =
                        config.permission && typeof config.permission === "object" && !Array.isArray(config.permission)
                            ? { ...config.permission }
                            : {};
                    permission.question = value;
                    config.permission = permission;
                }
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
                log.info({ backendId: backendName, policyField: field, value, configPath: localPath }, "updated opencode policy");
            } else if (backendName === "claude-code") {
                // JSON: read, set field, write
                let config: any = {};
                if (existsSync(localPath)) {
                    config = JSON.parse(readFileSync(localPath, "utf-8"));
                }
                if (field === "defaultMode") {
                    config.defaultMode = value;
                }
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
                log.info({ backendId: backendName, policyField: field, value, configPath: localPath }, "updated claude-code policy");
            }
        } catch (err) {
            log.warn({ backendId: backendName, policyField: field, err: err instanceof Error ? err.message : err }, "failed to update policy");
        }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Unified Config Write API
    // ══════════════════════════════════════════════════════════════════════

    /** Write / update a provider definition */
    writeProvider(backendId: string, input: UnifiedProviderInput): void {
        const source = CONFIG_SOURCES.find(s => s.name === backendId);
        if (!source) { log.warn({ backendId }, "writeSource: unknown backend"); return; }
        const localPath = join(this.configDir, source.localFile);

        try {
            if (backendId === "codex") {
                this.writeProviderCodex(localPath, input);
            } else if (backendId === "opencode") {
                this.writeProviderOpenCode(localPath, input);
            } else if (backendId === "claude-code") {
                this.writeProviderClaudeCode(localPath, input);
            }
            log.info({ backendId, providerName: input.name }, "writeSource OK");
        } catch (err) {
            log.warn({ backendId, err: err instanceof Error ? err.message : err }, "writeSource failed");
        }
    }

    /** Delete a provider */
    deleteProviderUnified(backendId: string, providerName: string): void {
        const source = CONFIG_SOURCES.find(s => s.name === backendId);
        if (!source) return;
        const localPath = join(this.configDir, source.localFile);

        try {
            if (backendId === "codex") {
                let content = existsSync(localPath) ? readFileSync(localPath, "utf-8") : "";
                content = this.removeTomlSection(content, `model_providers.${providerName}`);
                writeFileSync(localPath, content, "utf-8");
            } else {
                const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
                if (backendId === "opencode") delete config.provider?.[providerName];
                if (backendId === "claude-code") delete config.providers?.[providerName];
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
            }
            log.info({ backendId, providerName }, "deleteSourceUnified OK");
        } catch (err) {
            log.warn({ backendId, providerName, err: err instanceof Error ? err.message : err }, "deleteSourceUnified failed");
        }
    }

    /** Write / update a profile */
    writeProfile(backendId: string, input: UnifiedProfileInput): void {
        const source = CONFIG_SOURCES.find(s => s.name === backendId);
        if (!source) return;
        const localPath = join(this.configDir, source.localFile);

        try {
            if (backendId === "codex") {
                this.writeProfileCodex(localPath, input);
            } else if (backendId === "opencode") {
                // opencode: write into provider[providerName].models[modelId]
                const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
                if (!config.provider) config.provider = {};
                if (!config.provider[input.provider]) config.provider[input.provider] = { options: {}, models: {} };
                const provider = config.provider[input.provider];
                if (!provider.models) provider.models = {};
                // Build model entry in correct opencode schema
                const modelEntry: any = { name: input.name };
                modelEntry.modalities = { input: ["text"], output: ["text"] };
                if (input.extras?.thinking_budget_tokens) {
                    modelEntry.options = { thinking: { type: "enabled", budgetTokens: Number(input.extras.thinking_budget_tokens) } };
                }
                if (input.extras?.context_limit || input.extras?.output_limit) {
                    modelEntry.limit = {};
                    if (input.extras.context_limit) modelEntry.limit.context = Number(input.extras.context_limit);
                    if (input.extras.output_limit) modelEntry.limit.output = Number(input.extras.output_limit);
                }
                // modelId (JSON key) = input.model, display name = input.name
                provider.models[input.model] = modelEntry;
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
            } else {
                // claude-code or others: write profiles section
                const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
                if (!config.profiles) config.profiles = {};
                config.profiles[input.name] = {
                    model: input.model,
                    provider: input.provider,
                    ...(Object.keys(input.extras).length > 0 ? { extras: input.extras } : {})
                };
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
            }
            log.info({ backendId, profile: input.name }, "writeProfile OK");
        } catch (err) {
            log.warn({ backendId, err: err instanceof Error ? err.message : err }, "writeProfile failed");
        }
    }

    /** Delete a profile / model entry */
    deleteProfile(backendId: string, profileName: string): void {
        const source = CONFIG_SOURCES.find(s => s.name === backendId);
        if (!source) return;
        const localPath = join(this.configDir, source.localFile);

        try {
            if (backendId === "codex") {
                let content = existsSync(localPath) ? readFileSync(localPath, "utf-8") : "";
                content = this.removeTomlSection(content, `profiles.${profileName}`);
                writeFileSync(localPath, content, "utf-8");
            } else if (backendId === "opencode") {
                // opencode: delete from provider[name].models using modelId lookup
                const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
                const providers = config.provider ?? {};
                for (const providerDef of Object.values(providers) as any[]) {
                    const models = providerDef?.models;
                    if (!models) continue;
                    // Try direct key match (profileName might be the modelId)
                    if (models[profileName]) {
                        delete models[profileName];
                    } else {
                        // Fallback: find by display name
                        for (const [key, modelDef] of Object.entries(models) as [string, any][]) {
                            if (modelDef?.name === profileName) {
                                delete models[key];
                                break;
                            }
                        }
                    }
                }
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
            } else {
                const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
                delete config.profiles?.[profileName];
                writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
            }
            log.info({ backendId, profileName }, "deleteProfile OK");
        } catch (err) {
            log.warn({ backendId, profileName, err: err instanceof Error ? err.message : err }, "deleteProfile failed");
        }
    }

    // ── Per-backend write helpers ────────────────────────────────────────

    private writeProviderCodex(localPath: string, input: UnifiedProviderInput): void {
        let content = existsSync(localPath) ? readFileSync(localPath, "utf-8") : "";
        const sectionName = `model_providers.${input.name}`;

        content = this.removeTomlSection(content, sectionName);

        const envKeyName = input.envKeyName ?? `${input.name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
        const lines = [
            `\n[${sectionName}]`,
            `name = "${input.name}"`,
            `base_url = "${input.baseUrl}"`,
            ...(input.wireApi ? [`wire_api = "${input.wireApi}"`] : []),
            `env_key = "${envKeyName}"`,
            ...(input.apiKey ? [`api_key = "${input.apiKey}"`] : []),
        ];
        content = content.trimEnd() + "\n" + lines.join("\n") + "\n";
        writeFileSync(localPath, content, "utf-8");
    }

    private writeProviderOpenCode(localPath: string, input: UnifiedProviderInput): void {
        const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
        if (!config.provider) config.provider = {};

        const existing = config.provider[input.name] ?? {};
        config.provider[input.name] = {
            ...existing,
            options: { ...(existing.options ?? {}), baseURL: input.baseUrl, apiKey: input.apiKey },
        };
        writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
    }

    private writeProviderClaudeCode(localPath: string, input: UnifiedProviderInput): void {
        const config = existsSync(localPath) ? JSON.parse(readFileSync(localPath, "utf-8")) : {};
        if (!config.providers) config.providers = {};
        config.providers[input.name] = {
            baseUrl: input.baseUrl,
            apiKey: input.apiKey,
        };
        writeFileSync(localPath, JSON.stringify(config, null, 2), "utf-8");
    }

    private writeProfileCodex(localPath: string, input: UnifiedProfileInput): void {
        let content = existsSync(localPath) ? readFileSync(localPath, "utf-8") : "";
        const sectionName = `profiles.${input.name}`;

        content = this.removeTomlSection(content, sectionName);

        const lines = [
            `\n[${sectionName}]`,
            `model = "${input.model}"`,
            `model_provider = "${input.provider}"`,
        ];
        for (const [key, value] of Object.entries(input.extras)) {
            if (typeof value === "string") {
                lines.push(`${key} = "${value}"`);
            } else if (typeof value === "number" || typeof value === "boolean") {
                lines.push(`${key} = ${value}`);
            }
        }
        content = content.trimEnd() + "\n" + lines.join("\n") + "\n";
        writeFileSync(localPath, content, "utf-8");
    }

    // ── Deploy helpers (called from BackendConfigInfo closures) ──────────

    /** Codex deploy: create .codex/ directory in worktree */
    _deployCodex(
        _localPath: string, cwd: string, _modelName: string,
        _parsed: Record<string, Record<string, string>>,
        _root: Record<string, string>,
        _providerMap: Map<string, ProviderInfo>
    ): void {
        mkdirSync(join(cwd, ".codex"), { recursive: true });
        log.info({ cwd }, "deploy codex: created .codex/ dir");
    }

    /** Codex buildServerCmd: -c flag injection */
    _buildCodexServerCmd(
        _localPath: string, modelName: string, cwd: string | undefined,
        providerMap: Map<string, ProviderInfo>
    ): CodexServerCmdResult {
        const defaultResult: CodexServerCmdResult = { serverCmd: "codex app-server", env: {} };

        // Find the model across providers
        let targetModel: ModelInfo | undefined;
        let targetProvider: ProviderInfo | undefined;
        for (const provider of providerMap.values()) {
            const m = provider.models.find(m => m.name === modelName);
            if (m) { targetModel = m; targetProvider = provider; break; }
        }
        if (!targetModel || !targetProvider) return defaultResult;

        const flags: string[] = [];
        const pn = targetProvider.name;
        flags.push(`-c 'model_providers.${pn}.name="${pn}"'`);
        if (targetProvider.baseUrl) flags.push(`-c 'model_providers.${pn}.base_url="${targetProvider.baseUrl}"'`);
        if (targetProvider.wireApi) flags.push(`-c 'model_providers.${pn}.wire_api="${targetProvider.wireApi}"'`);
        const envKeyName = targetProvider.apiKeyEnv ?? `${pn.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
        flags.push(`-c 'model_providers.${pn}.env_key="${envKeyName}"'`);

        // Model / model_provider
        flags.push(`-c 'model="${targetModel.modelId}"'`);
        flags.push(`-c 'model_provider="${pn}"'`);

        // Model extras (transparent passthrough)
        for (const [key, value] of Object.entries(targetModel.extras)) {
            if (typeof value === "string") {
                flags.push(`-c '${key}="${value}"'`);
            } else if (typeof value === "number" || typeof value === "boolean") {
                flags.push(`-c '${key}=${value}'`);
            }
        }

        // Trust cwd
        if (cwd) {
            flags.push(`-c 'projects."${cwd}".trust_level="trusted"'`);
        }

        // Env: inject API key
        const env: Record<string, string> = {};
        if (targetProvider.apiKey) {
            env[envKeyName] = targetProvider.apiKey;
        }

        return {
            serverCmd: `codex app-server ${flags.join(" ")}`,
            env
        };
    }

    /** OpenCode deploy: write .opencode/config.json */
    _deployOpenCode(cwd: string, modelName: string, parsed: any, providers: ProviderInfo[]): void {
        const dir = join(cwd, ".opencode");
        mkdirSync(dir, { recursive: true });

        // Find the model and its provider
        let targetModel: ModelInfo | undefined;
        let targetProvider: ProviderInfo | undefined;
        for (const provider of providers) {
            const m = provider.models.find(m => m.name === modelName);
            if (m) { targetModel = m; targetProvider = provider; break; }
        }

        const modelFull = targetProvider ? `${targetProvider.name}/${targetModel?.modelId ?? modelName}` : modelName;
        const config: any = {
            "$schema": "https://opencode.ai/config.json",
            model: modelFull,
        };
        if (parsed.permission !== undefined) {
            config.permission = parsed.permission;
        }
        if (targetProvider) {
            const modelsObj: any = {};
            if (targetModel && Object.keys(targetModel.extras).length > 0) {
                modelsObj[targetModel.modelId] = targetModel.extras;
            }
            config.provider = {
                [targetProvider.name]: {
                    options: { baseURL: targetProvider.baseUrl, apiKey: targetProvider.apiKey },
                    ...(Object.keys(modelsObj).length > 0 ? { models: modelsObj } : {}),
                },
            };
        }
        writeFileSync(join(dir, "config.json"), JSON.stringify(config, null, 2), "utf-8");
        log.info({ cwd, model: modelFull }, "deployed opencode config");
    }

    /** Claude deploy: write .claude/settings.json */
    _deployClaude(cwd: string, modelName: string, providers: ProviderInfo[]): void {
        const dir = join(cwd, ".claude");
        mkdirSync(dir, { recursive: true });

        // Find the model and its provider
        let targetModel: ModelInfo | undefined;
        let targetProvider: ProviderInfo | undefined;
        for (const provider of providers) {
            const m = provider.models.find(m => m.name === modelName);
            if (m) { targetModel = m; targetProvider = provider; break; }
        }

        const settings: any = {
            model: targetModel?.modelId ?? modelName,
        };
        if (targetProvider) {
            settings.env = {
                ANTHROPIC_BASE_URL: targetProvider.baseUrl,
                ANTHROPIC_AUTH_TOKEN: targetProvider.apiKey,
                ANTHROPIC_MODEL: targetModel?.modelId ?? modelName,
                ANTHROPIC_SMALL_FAST_MODEL: targetModel?.modelId ?? modelName,
                ANTHROPIC_DEFAULT_SONNET_MODEL: targetModel?.modelId ?? modelName,
                ANTHROPIC_DEFAULT_OPUS_MODEL: targetModel?.modelId ?? modelName,
                ANTHROPIC_DEFAULT_HAIKU_MODEL: targetModel?.modelId ?? modelName,
            };
        }
        writeFileSync(join(dir, "settings.json"), JSON.stringify(settings, null, 2), "utf-8");
        log.info({ cwd, model: targetModel?.modelId ?? modelName }, "deployed claude-code config");
    }

    // ── TOML helpers ────────────────────────────────────────────────────

    /**
     * Remove a TOML section and all its key-value pairs.
     * e.g., removeTomlSection(content, "model_providers.codex") removes
     * [model_providers.codex] and all lines until the next section or EOF.
     */
    private removeTomlSection(content: string, sectionName: string): string {
        const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(
            `\\n?\\[${escapedName}\\][^\\[]*`,
            "g"
        );
        return content.replace(regex, "");
    }
}
