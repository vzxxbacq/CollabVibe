/**
 * @module services/orchestrator/src/factory
 *
 * Factory function that encapsulates construction of the entire orchestrator layer.
 * `server.ts` calls `createOrchestratorLayer(deps)` instead of manually constructing
 * 15+ internal services.
 */
import type { DatabaseSync } from "node:sqlite";
import type { OrchestratorConfig } from "../../contracts/admin/contracts";
import type { PersistenceLayer } from "../../persistence/src/factory";
import type { OutputGateway, PlatformOutput } from "../../contracts/im/platform-output";
import { createLogger } from "../../../packages/logger/src/index";
import { createBackendIdentity, isBackendId } from "../../../packages/agent-core/src/backend-identity";
import { AgentProcessManager } from "../../../packages/agent-core/src/agent-process-manager";
import { CodexProtocolApiFactory } from "../../../packages/agent-core/src/transports/codex/codex-api-factory";
import { AcpApiFactory } from "../../../packages/agent-core/src/transports/acp/acp-api-factory";

import { ConversationOrchestrator } from "./orchestrator";
import { AgentApiFactoryRegistry } from "./session/factory-registry";
import { DefaultAgentApiPool } from "./session/agent-api-pool";
import { DefaultRuntimeConfigProvider } from "./backend/runtime-config-provider";
import type { RuntimeDefaults } from "./backend/runtime-defaults";
import { createBackendRegistry } from "./backend/registry";
import { DefaultBackendSessionResolver } from "./backend/session-resolver";
import { BackendConfigService } from "./backend/config-service";
import { UserThreadBindingService } from "./thread-state/user-thread-binding-service";
import { EventPipeline } from "./event/pipeline";
import { AgentEventRouter } from "./event/router";
import { PluginService } from "./plugin/plugin-service";
import { ApprovalCallbackHandler } from "./approval/index";
import { RoleResolver } from "./iam/role-resolver";
import { AuditService } from "./audit/index";
import type { ProjectConfig } from "../../contracts/admin/contracts";
import { ProjectSetupService } from "./project-setup-service";

// ── Public result type ──────────────────────────────────────────────────────

export interface OrchestratorLayer {
  /** The main orchestrator instance */
  orchestrator: ConversationOrchestrator;
  /** Plugin service for skill management */
  pluginService: PluginService;
  /** Approval callback handler */
  approvalHandler: ApprovalCallbackHandler;
  /** Role resolver for IAM */
  roleResolver: RoleResolver;
  /** Audit service */
  auditService: AuditService;
  /** Project setup service */
  projectSetupService: ProjectSetupService;
  /** Project lookup by chatId */
  findProjectByChatId(chatId: string): ProjectConfig | null;

  /**
   * Wire the OutputGateway and run all startup tasks:
   * 1. Bind EventPipeline + onResolverComplete hooks
   * 2. Backfill missing project metadata (gitUrl, defaultBranch, timestamps)
   * 3. Recover sessions for active projects
   *
   * Must be called after platform bootstrap.
   */
  runStartup(gateway: OutputGateway): Promise<void>;

  /** Release all resources */
  shutdown(): Promise<void>;
}

// ── Factory function ────────────────────────────────────────────────────────

export interface OrchestratorLayerDeps {
  persistence: PersistenceLayer;
  config: OrchestratorConfig;
}

export async function createOrchestratorLayer(deps: OrchestratorLayerDeps): Promise<OrchestratorLayer> {
  const log = createLogger("orchestrator-factory");
  const { persistence, config } = deps;
  const adminStateStore = persistence.adminStateStore;

  // ── Project resolver ──
  const findProjectByChatId = (chatId: string) => {
    const state = adminStateStore.read();
    return state.projects.find((item) => item.chatId === chatId) ?? null;
  };
  const findProjectById = (projectId: string) => {
    const state = adminStateStore.read();
    return state.projects.find((item) => item.id === projectId) ?? null;
  };
  const projectResolver = {
    findProjectByChatId,
    findProjectById,
    listActiveProjects: () => {
      const state = adminStateStore.read();
      return state.projects.filter((item) => item.status === "active" && item.chatId);
    }
  };

  // ── Backend infrastructure ──
  const backendRegistry = createBackendRegistry();
  const backendConfigService = new BackendConfigService("data/config");
  backendConfigService.ensureLocalConfigs();
  const threadRegistry = persistence.threadRegistry;
  const userThreadBindingService = new UserThreadBindingService(persistence.userThreadBindingRepo);
  const backendSessionResolver = new DefaultBackendSessionResolver(
    backendRegistry, backendConfigService, (chatId, threadName) => {
      const projectId = projectResolver.findProjectByChatId(chatId)?.id;
      return projectId ? threadRegistry.get(projectId, threadName) : null;
    }
  );
  await backendSessionResolver.ensureSync();

  // ── Plugin service ──
  const pluginService = new PluginService(
    config.cwd,
    persistence.pluginCatalogStore,
    undefined,
    adminStateStore,
  );

  // ── API pool ──
  const processManager = new AgentProcessManager();
  const currentBackend = backendRegistry.getDefault();
  const defaultBackendName = currentBackend?.name ?? "codex";
  const defaultModel = currentBackend?.models?.[0] ?? "gpt-5-codex";
  const runtimeDefaults: RuntimeDefaults = {
    defaultBackend: createBackendIdentity(
      isBackendId(defaultBackendName) ? defaultBackendName : "codex",
      defaultModel
    ),
    cwd: config.cwd,
    sandbox: config.sandbox,
    approvalPolicy: config.approvalPolicy,
    serverCmd: currentBackend?.serverCmd ?? "codex app-server",
    serverPort: config.server.port,
  };
  const runtimeConfigProvider = new DefaultRuntimeConfigProvider(projectResolver, runtimeDefaults);
  const apiFactory = new AgentApiFactoryRegistry({
    codex: new CodexProtocolApiFactory(processManager),
    acp: new AcpApiFactory(),
  });
  const apiPool = new DefaultAgentApiPool({ apiFactory });

  // ── Orchestrator ──
  const orchestrator = new ConversationOrchestrator({
    agentApiPool: apiPool,
    runtimeConfigProvider,
    userThreadBindingService,
    snapshotRepo: persistence.snapshotRepo,
    mergeSessionRepository: persistence.mergeSessionRepo,
    turnRepository: persistence.turnRepo,
    turnDetailRepository: persistence.turnDetailRepo,
    threadTurnStateRepository: persistence.threadTurnStateRepo,
    approvalTimeoutMs: config.server.approvalTimeoutMs,
    pluginService,
    cwd: config.cwd,
    threadRegistry,
    backendRegistry,
    backendSessionResolver,
    backendConfigService,
    projectResolver,
  });

  // ── Supporting services ──
  const approvalHandler = new ApprovalCallbackHandler(
    persistence.approvalStore,
    { applyDecision: orchestrator.resume.bind(orchestrator) }
  );
  const userRepo = persistence.userRepo;
  userRepo.seedEnvAdmins(config.server.sysAdminUserIds);
  const roleResolver = new RoleResolver(userRepo, adminStateStore);
  const auditService = new AuditService(persistence.auditStore);
  const projectSetupService = new ProjectSetupService(adminStateStore, config);

  // ── runStartup (deferred — called after platform bootstrap) ──
  async function runStartup(gateway: OutputGateway): Promise<void> {
    // 1. Wire output: resolver hooks + event pipeline
    orchestrator.onResolverComplete((info) => {
      const output: PlatformOutput = info.success
        ? {
          kind: "thread_merge",
          data: {
            kind: "thread_merge",
            action: "preview",
            branchName: info.resolverName,
            baseBranch: info.baseBranch,
            message: info.message,
            diffStats: info.diffStats,
          },
        }
        : {
          kind: "thread_merge",
          data: {
            kind: "thread_merge",
            action: "conflict",
            branchName: info.branchName,
            baseBranch: info.baseBranch,
            message: info.message,
            conflicts: info.remaining,
          },
        };
      gateway.dispatch(info.chatId, output).catch((error) =>
        log.warn({
          chatId: info.chatId,
          branchName: info.success ? info.resolverName : info.branchName,
          err: error instanceof Error ? error.message : String(error),
        }, info.success ? "send merge preview failed" : "send merge conflict failed")
      );
    });

    const eventPipeline = new EventPipeline(
      new AgentEventRouter((chatId, output) => gateway.dispatch(chatId, output)),
      {
        registerApprovalRequest: orchestrator.registerApprovalRequest.bind(orchestrator),
        finishTurn: orchestrator.finishTurn.bind(orchestrator),
        syncTurnState: orchestrator.syncTurnState.bind(orchestrator),
        finalizeTurnState: orchestrator.finalizeTurnState.bind(orchestrator),
      },
    );
    orchestrator.setEventPipeline(eventPipeline);
    orchestrator.startHealthCheck();
    orchestrator.runStartupValidation();

    // 2. Backfill missing project metadata
    try {
      const { detectDefaultBranch, getRemoteUrl } = await import("../../../packages/git-utils/src/index");
      const state = adminStateStore.read();
      let dirty = false;
      for (const p of state.projects) {
        if (!p.gitUrl && p.cwd) {
          try {
            const url = await getRemoteUrl(p.cwd);
            if (url) { p.gitUrl = url; dirty = true; }
          } catch (error) {
            log.warn({ projectId: p.id, cwd: p.cwd, err: error instanceof Error ? error.message : String(error) }, "startup: getRemoteUrl failed");
          }
        }
        if (!p.defaultBranch && p.cwd) {
          try {
            p.defaultBranch = await detectDefaultBranch(p.cwd);
            dirty = true;
          } catch (error) {
            log.warn({ projectId: p.id, cwd: p.cwd, err: error instanceof Error ? error.message : String(error) }, "startup: detectDefaultBranch failed");
          }
        }
        if (!p.createdAt) { p.createdAt = new Date().toISOString(); dirty = true; }
        if (!p.updatedAt) { p.updatedAt = p.createdAt ?? new Date().toISOString(); dirty = true; }
      }
      if (dirty) {
        adminStateStore.write(state);
        log.info("startup: backfilled project gitUrl/defaultBranch/timestamps");
      }
    } catch (err) {
      log.warn({ err }, "startup: project metadata backfill failed");
    }

    // 3. Recover sessions for active projects
    const state = adminStateStore.read();
    const activeProjectIds = state.projects
      .filter((p) => p.status === "active" && p.chatId)
      .map((p) => p.id);
    if (activeProjectIds.length > 0) {
      const { recovered, failed, failures, mergeFailures } = await orchestrator.recoverSessions(activeProjectIds);
      if (failed > 0) {
        log.error({ failures, mergeFailures }, "startup: session recovery failures");
        for (const failure of mergeFailures) {
          if (!failure.chatId) continue;
          try {
            const review = await orchestrator.getMergeReview(failure.chatId, failure.branchName);
            await gateway.dispatch(failure.chatId, {
              kind: "merge_review",
              data: review,
            });
          } catch (error) {
            log.warn({
              chatId: failure.chatId,
              branchName: failure.branchName,
              err: error instanceof Error ? error.message : String(error),
            }, "startup: failed to push recovery-required merge card");
          }
        }
      }
      log.info({ recovered, failed }, "startup: session recovery done");
    }
  }

  return {
    orchestrator,
    pluginService,
    approvalHandler,
    roleResolver,
    auditService,
    projectSetupService,
    findProjectByChatId,
    runStartup,
    shutdown: async () => {
      orchestrator.stopHealthCheck();
      if (typeof apiPool.releaseAll === "function") {
        await apiPool.releaseAll();
      }
    },
  };
}
