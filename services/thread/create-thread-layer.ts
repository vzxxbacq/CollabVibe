/**
 * @module thread/create-thread-layer
 *
 * Domain sub-factory for Thread services.
 * Called by factory.ts during composition — keeps construction logic
 * inside the thread domain folder.
 */
import type { AgentApiPool, RuntimeConfigProvider } from "../../packages/agent-core/src/index";
import type { BackendRegistry } from "../backend/registry";
import type { BackendConfigService } from "../backend/config-service";
import type { PluginService } from "../plugin/plugin-service";
import type { ProjectResolver } from "../project/project-resolver";
import type { ThreadRegistry } from "./contracts";
import type { ThreadTurnStateRepository } from "./thread-turn-state-repository";
import type { TurnRepository } from "../turn/turn-repository";
import { UserThreadBindingService } from "./user-thread-binding-service";
import { ThreadService } from "./thread-service";
import { ThreadRuntimeService } from "./thread-runtime-service";
import { ThreadUseCaseService } from "./thread-use-case-service";
import type { GitOps } from "../../packages/git-utils/src/index";

export interface ThreadLayerDeps {
  threadRegistry: ThreadRegistry;
  userThreadBindingService: UserThreadBindingService;
  threadTurnStateRepository: ThreadTurnStateRepository;
  turnRepository: TurnRepository;
  agentApiPool: AgentApiPool;
  runtimeConfigProvider: RuntimeConfigProvider;
  backendRegistry?: BackendRegistry;
  backendConfigService?: BackendConfigService;
  pluginService?: PluginService;
  projectResolver?: ProjectResolver;
  gitOps: GitOps;
}

export interface ThreadLayer {
  threadService: ThreadService;
  threadRuntimeService: ThreadRuntimeService;
  threadUseCaseService: ThreadUseCaseService;
}

export function createThreadLayer(deps: ThreadLayerDeps): ThreadLayer {
  const nowIso = () => new Date().toISOString();

  const threadService = new ThreadService(
    deps.threadRegistry,
    deps.userThreadBindingService,
    deps.threadTurnStateRepository,
    nowIso,
    (projectId, turnId) => deps.turnRepository.getByTurnIdSync(projectId, turnId)?.status,
  );

  const threadRuntimeService = new ThreadRuntimeService({
    agentApiPool: deps.agentApiPool,
    runtimeConfigProvider: deps.runtimeConfigProvider,
    backendRegistry: deps.backendRegistry,
    backendConfigService: deps.backendConfigService,
    pluginService: deps.pluginService,
    threadRegistry: deps.threadRegistry,
    projectResolver: deps.projectResolver,
    threadService,
    gitOps: deps.gitOps,
  });

  const threadUseCaseService = new ThreadUseCaseService(
    threadService,
    threadRuntimeService,
    deps.pluginService,
  );

  return { threadService, threadRuntimeService, threadUseCaseService };
}
