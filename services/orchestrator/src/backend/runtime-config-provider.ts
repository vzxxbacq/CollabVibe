import type { RuntimeConfigProvider, RuntimeConfig } from "../../../../packages/agent-core/src/types";
import type { RuntimeDefaults } from "./runtime-defaults";
import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import type { ProjectResolver } from "../project/project-resolver";
import type { ProjectRecord } from "../../../contracts/admin/admin-state";
import { ErrorCode, OrchestratorError } from "../errors";

type RuntimeDefaultsInput = RuntimeDefaults | {
  codex?: {
    model?: string;
    cwd?: string;
    sandbox?: string;
    approvalPolicy?: string;
  };
};

function normalizeDefaults(defaults: RuntimeDefaultsInput): RuntimeDefaults {
  if ("defaultBackend" in defaults) {
    return defaults;
  }
  return {
    defaultBackend: createBackendIdentity("codex", defaults.codex?.model ?? ""),
    cwd: defaults.codex?.cwd ?? "",
    sandbox: defaults.codex?.sandbox ?? "",
    approvalPolicy: defaults.codex?.approvalPolicy || "on-request",
  };
}

function toRuntimeConfig(project: ProjectRecord | null, defaults: RuntimeDefaults): RuntimeConfig {
  return {
    backend: defaults.defaultBackend,
    cwd: project?.cwd ?? defaults.cwd,
    baseBranch: project?.workBranch,
    sandbox: project?.sandbox ?? defaults.sandbox,
    approvalPolicy: project?.approvalPolicy ?? defaults.approvalPolicy,
  };
}

/**
 * @layer services/orchestrator
 *
 * Simplified runtime config provider.
 * Only resolves project-level + global-default config.
 *
 * Thread-level config (backend identity, cwd suffix, session ID) is handled by:
 *   - `orchestrator.buildThreadConfig()` for new threads
 *   - `orchestrator.resolveAgentApi()` for existing threads (via pool cache)
 *
 * Phase 6B/6C: Removed `resolveWithBinding()` — thread binding resolution
 * is now orchestrator's responsibility, eliminating Resolver/Provider overlap.
 */
export class DefaultRuntimeConfigProvider implements RuntimeConfigProvider {
  private readonly runtimeDefaults: RuntimeDefaults;

  constructor(
    private readonly adminApi: ProjectResolver | null,
    globalDefaults: RuntimeDefaultsInput,
  ) {
    this.runtimeDefaults = normalizeDefaults(globalDefaults);
  }

  async getProjectRuntimeConfig(projectId: string, _userId?: string): Promise<RuntimeConfig> {
    if (!this.adminApi || typeof this.adminApi.findProjectById !== "function") {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, "project resolver is required for runtime config resolution");
    }
    if (!projectId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, "projectId is required for runtime config resolution");
    }
    const project = this.adminApi.findProjectById(projectId);
    if (!project) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }
    return toRuntimeConfig(project, this.runtimeDefaults);
  }
}
