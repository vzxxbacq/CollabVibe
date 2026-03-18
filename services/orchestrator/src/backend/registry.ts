import type { TransportType } from "../../../../packages/agent-core/src/backend-identity";
import { defaultPluginDirForBackend } from "../../plugin/plugin-paths";

export interface BackendDefinition {
    /** Unique name, e.g. "codex", "opencode", "claude-code" */
    name: string;
    /** Transport used by the backend client */
    transport: TransportType;
    /** Shell command to start the backend server process */
    serverCmd: string;
    /** Human-readable display name */
    description?: string;
    /** Models supported by this backend */
    models?: string[];
    /** Skill directory relative to project cwd (defaults based on backend name) */
    pluginDir?: string;
    /** Environment variables to pass to the backend process */
    env?: Record<string, string>;
}

/**
 * Registry of available backend engines.
 * Populated by BackendConfigService.ensureSync() at runtime — no longer reads from ENV.
 */
export class BackendRegistry {
    private readonly backends = new Map<string, BackendDefinition>();
    private defaultName = "";

    register(def: BackendDefinition): void {
        this.backends.set(def.name, def);
        if (!this.defaultName) {
            this.defaultName = def.name;
        }
    }

    /** Full-replace an existing backend definition, or register if new. */
    upsert(def: BackendDefinition): void {
        this.backends.set(def.name, def);
        if (!this.defaultName) {
            this.defaultName = def.name;
        }
    }

    get(name: string): BackendDefinition | undefined {
        return this.backends.get(name);
    }

    list(): BackendDefinition[] {
        return [...this.backends.values()];
    }

    getDefault(): BackendDefinition | undefined {
        return this.backends.get(this.defaultName);
    }

    getDefaultName(): string {
        return this.defaultName;
    }

    setDefault(name: string): void {
        if (this.backends.has(name)) {
            this.defaultName = name;
        }
    }

    has(name: string): boolean {
        return this.backends.has(name);
    }

    /** Update models list for an existing backend */
    updateModels(name: string, models: string[]): void {
        const def = this.backends.get(name);
        if (def) def.models = models;
    }

    /** Register a backend only if it doesn't already exist */
    registerIfMissing(def: BackendDefinition): void {
        if (!this.backends.has(def.name)) {
            this.register(def);
        }
    }
}

/**
 * Create an empty backend registry.
 * Backend definitions are populated later by BackendConfigService via ensureSync().
 */
export function createBackendRegistry(): BackendRegistry {
    return new BackendRegistry();
}
