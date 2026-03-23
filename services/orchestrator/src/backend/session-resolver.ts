import type { BackendIdentity, TransportType } from "../../../../packages/agent-core/src/backend-identity";
import { createBackendIdentity, isBackendId } from "../../../../packages/agent-core/src/backend-identity";
import type { BackendDefinition, BackendRegistry } from "./registry";
import type { BackendConfigService } from "./config-service";
import type { ThreadRecord } from "../thread/thread-registry";

// ── Resolved session types ──────────────────────────────────────────────────

export interface ResolvedBackendSession {
    /** Atomic backend identity (I2 compliant) */
    backend: BackendIdentity;
    serverCmd: string;
    availableModels: string[];
    /** Where the resolution came from */
    source: "thread-binding" | "default";
}

export interface AvailableBackend {
    name: string;
    description?: string;
    transport: TransportType;
    serverCmd: string;
    models: string[];
}

export interface BackendSessionResolver {
    /** Resolve backend for a project-bound chat, optionally for a specific thread */
    resolve(chatId: string, threadName?: string): Promise<ResolvedBackendSession>;
    /** List all available backends + models (pure read after ensureSync) */
    listAvailableBackends(): Promise<AvailableBackend[]>;
    /** Get default backend name */
    getDefaultBackendName(): string;
    /** Get default model */
    getDefaultModel(): string;
    /** Resolve a backend definition by name */
    resolveBackendByName(name: string): Promise<BackendDefinition | undefined>;
}

// ── Implementation ──────────────────────────────────────────────────────────

export class DefaultBackendSessionResolver implements BackendSessionResolver {
    private synced = false;

    constructor(
        private readonly backendRegistry: BackendRegistry,
        private readonly backendConfigService: BackendConfigService,
        private readonly resolveThreadRecord?: (chatId: string, threadName: string) => ThreadRecord | null,
    ) { }

    /**
     * Read all config files and upsert backend definitions into the registry.
     * Called once at startup and lazily before resolve/list if not yet synced.
     */
    async ensureSync(): Promise<void> {
        const configs = await this.backendConfigService.readAllConfigs();

        for (const config of configs) {
            const allConfigModels = config.providers.flatMap(p => p.models.map(m => m.name));
            // Determine active model from config (current model marker)
            const activeModel = config.providers
                .flatMap(p => p.models)
                .find(m => m.isCurrent)?.name;

            const def: BackendDefinition = {
                name: config.name,
                transport: config.transport,
                serverCmd: config.serverCmd,
                models: allConfigModels,
                env: config.env
            };

            this.backendRegistry.upsert(def);
        }

        this.synced = true;
    }

    async resolve(chatId: string, threadName?: string): Promise<ResolvedBackendSession> {
        if (!this.synced) await this.ensureSync();

        // Priority 1: thread binding → read backend from ThreadRegistry
        if (threadName) {
            const threadRecord = this.resolveThreadRecord?.(chatId, threadName);
            if (!threadRecord?.backend) {
                throw new Error(`thread backend session not found: chatId=${chatId} threadName=${threadName}`);
            }
            const backend = threadRecord.backend;
            const backendDef = this.backendRegistry.get(backend.backendId);
            if (!backendDef) {
                throw new Error(`backend definition missing for thread backend: backendId=${backend.backendId} chatId=${chatId} threadName=${threadName}`);
            }
            const availableModels = this.getModelsForBackend(backend.backendId);

            return {
                backend,
                serverCmd: backendDef.serverCmd,
                availableModels,
                source: "thread-binding"
            };
        }

        // Priority 2: global defaults from registry
        const defaultBackend = this.backendRegistry.getDefault();
        if (!defaultBackend) {
            throw new Error("default backend is not configured");
        }
        const backendName = defaultBackend.name;
        const serverCmd = defaultBackend.serverCmd;
        const availableModels = this.getModelsForBackend(backendName);
        const model = this.getActiveModelForBackend(backendName);
        if (!model) {
            throw new Error(`default backend has no resolvable model: backend=${backendName}`);
        }
        if (!isBackendId(backendName)) {
            throw new Error(`default backend is not a valid BackendId: backend=${backendName}`);
        }

        return {
            backend: createBackendIdentity(backendName, model),
            serverCmd,
            availableModels,
            source: "default"
        };
    }

    async listAvailableBackends(): Promise<AvailableBackend[]> {
        if (!this.synced) await this.ensureSync();

        // Pure read — registry already populated by ensureSync
        return this.backendRegistry.list().map(def => ({
            name: def.name,
            description: def.description,
            transport: def.transport,
            serverCmd: def.serverCmd,
            models: def.models ?? []
        }));
    }

    getDefaultBackendName(): string {
        const name = this.backendRegistry.getDefaultName();
        if (!name) {
            throw new Error("default backend name is not configured");
        }
        return name;
    }

    getDefaultModel(): string {
        const defaultBackend = this.backendRegistry.getDefault();
        if (!defaultBackend) {
            throw new Error("default backend is not configured");
        }
        const model = this.getActiveModelForBackend(defaultBackend.name);
        if (!model) {
            throw new Error(`default backend has no resolvable model: backend=${defaultBackend.name}`);
        }
        return model;
    }

    /** Resolve a backend definition by name (for handlers that need serverCmd/transport) */
    async resolveBackendByName(name: string): Promise<BackendDefinition | undefined> {
        if (!this.synced) await this.ensureSync();
        return this.backendRegistry.get(name);
    }

    /** Force re-sync: re-read config files and upsert into registry */
    async reSync(): Promise<void> {
        this.synced = false;
        await this.ensureSync();
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    private getModelsForBackend(backendName: string): string[] {
        return this.backendRegistry.get(backendName)?.models ?? [];
    }

    /** Get the "current" model from config files (isCurrent marker) */
    private getActiveModelForBackend(backendName: string): string | undefined {
        // Already synced into registry — return first model as best guess.
        // A more precise approach would track isCurrent during sync.
        const models = this.backendRegistry.get(backendName)?.models;
        return models && models.length > 0 ? models[0] : undefined;
    }
}
