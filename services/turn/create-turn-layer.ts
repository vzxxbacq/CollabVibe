/**
 * @module turn/create-turn-layer
 *
 * Domain sub-factory for Turn services.
 * Breaks the orchestrator circular dependency by accepting resolveAgentApi
 * and resolveThreadName as plain functions (no .bind(this) needed).
 */
import type { AgentApi } from "../../packages/agent-core/src/index";
import type { PluginService } from "../plugin/plugin-service";
import type { ProjectResolver } from "../project/project-resolver";
import type { SnapshotRepository } from "../snapshot/contracts";
import type { ThreadService } from "../thread/thread-service";
import type { ThreadRuntimeService } from "../thread/thread-runtime-service";
import type { TurnRepository } from "./turn-repository";
import type { TurnDetailRepository } from "./turn-detail-repository";
import { TurnQueryService } from "./turn-query-service";
import { TurnCommandService } from "./turn-command-service";
import { OrchestratorError, ErrorCode } from "../errors";
import type { GitOps } from "../../packages/git-utils/src/index";

export interface TurnLayerDeps {
  turnRepository: TurnRepository;
  turnDetailRepository: TurnDetailRepository;
  threadService: ThreadService;
  threadRuntimeService: ThreadRuntimeService;
  projectResolver: ProjectResolver;
  snapshotRepo?: SnapshotRepository;
  pluginService?: PluginService;
  gitOps: GitOps;
}

export interface TurnLayer {
  turnQueryService: TurnQueryService;
  turnCommandService: TurnCommandService;
}

export function createTurnLayer(deps: TurnLayerDeps): TurnLayer {
  const nowIso = () => new Date().toISOString();

  const baseDeps = {
    turnRepository: deps.turnRepository,
    turnDetailRepository: deps.turnDetailRepository,
    threadService: deps.threadService,
    projectResolver: deps.projectResolver,
    nowIso,
  };

  const turnQueryService = new TurnQueryService(baseDeps);

  // ── Break circular dependency: resolveAgentApi / resolveThreadName ──
  // These were orchestrator private methods bound via .bind(this).
  // Now they are plain lambdas referencing already-constructed services.

  const requireProjectId = (projectId: string): string => {
    const resolvedProjectId = deps.projectResolver.findProjectById?.(projectId)?.id ?? null;
    if (!resolvedProjectId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }
    return resolvedProjectId;
  };

  const resolveAgentApi = async (projectId: string, threadName: string): Promise<AgentApi> => {
    const resolvedProjectId = requireProjectId(projectId);
    const cached = deps.threadRuntimeService.getApi(resolvedProjectId, threadName);
    if (cached) {
      await deps.pluginService?.ensureProjectThreadSkills?.(resolvedProjectId, threadName);
      return cached;
    }
    const record = deps.threadService.getRecord(resolvedProjectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, `agent api unavailable for project-thread ${resolvedProjectId}/${threadName}`);
    }
    throw new OrchestratorError(
      ErrorCode.AGENT_API_UNAVAILABLE,
      `agent api unavailable for project-thread ${resolvedProjectId}/${threadName}: session not preloaded at startup`
    );
  };

  const resolveThreadName = async (projectId: string, userId?: string): Promise<string | null> => {
    if (!userId) return null;
    const binding = await deps.threadService.getUserBinding(requireProjectId(projectId), userId);
    return binding?.threadName ?? null;
  };

  const turnCommandService = new TurnCommandService({
    ...baseDeps,
    snapshotRepo: deps.snapshotRepo,
    resolveAgentApi,
    resolveThreadName,
    gitOps: deps.gitOps,
  });

  return { turnQueryService, turnCommandService };
}
