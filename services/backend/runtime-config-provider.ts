import type { RuntimeConfigProvider, RuntimeConfig } from "../../packages/agent-core/src/index";
import type { RuntimeDefaults } from "./runtime-defaults";
import type { ProjectResolver } from "../project/project-resolver";
import type { ProjectRecord } from "../project/project-types";
import { ErrorCode, OrchestratorError } from "../errors";

function toRuntimeConfig(project: ProjectRecord | null, defaults: RuntimeDefaults): RuntimeConfig {
  return {
    backend: defaults.defaultBackend,
    cwd: project?.cwd ?? defaults.cwd,
    baseBranch: project?.workBranch,
    sandbox: project?.sandbox ?? defaults.sandbox,
    approvalPolicy: project?.approvalPolicy ?? defaults.approvalPolicy,
    approvalTimeoutMs: defaults.approvalTimeoutMs,
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
    globalDefaults: RuntimeDefaults,
  ) {
    this.runtimeDefaults = globalDefaults;
  }

  async getProjectRuntimeConfig(projectId: string, _userId?: string): Promise<RuntimeConfig> {
    if (!this.adminApi || typeof this.adminApi.findProjectById !== "function") {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, "project resolver is required for runtime config resolution");
    }
    if (!projectId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, "projectId is required for runtime config resolution");
    }
    const project = await this.adminApi.findProjectById(projectId);
    if (!project) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }
    return toRuntimeConfig(project, this.runtimeDefaults);
  }
}
