/**
 * @module services/factory
 *
 * Factory function that encapsulates construction of the entire orchestrator layer.
 * `server.ts` calls `createOrchestratorLayer(deps)` instead of manually constructing
 * 15+ internal services.
 */
import type { OrchestratorConfig } from "./project/app-config";
import type { OutputGateway, PlatformOutput } from "./event/output-contracts";
import type { MergeResult, OrchestratorApi, OrchestratorLayer } from "./orchestrator-api";
import type { MergeTurnPipeline } from "./merge/merge-types";
import { createLogger } from "../packages/logger/src/index";
import { createBackendIdentity, isBackendId } from "../packages/agent-core/src/index";
import { createDefaultTransportFactories } from "../packages/agent-core/src/index";
import type { AgentApiFactory } from "../packages/agent-core/src/index";
import { createPersistenceLayer } from "./persistence/factory";
import { createDatabase } from "./persistence/database";
import type { PersistenceLayer } from "./persistence/factory";
import type { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { AgentApiFactoryRegistry } from "./session/factory-registry";
import { DefaultAgentApiPool } from "./session/agent-api-pool";
import { DefaultRuntimeConfigProvider } from "./backend/runtime-config-provider";
import type { RuntimeDefaults } from "./backend/runtime-defaults";
import { createBackendRegistry } from "./backend/registry";
import { DefaultBackendSessionResolver } from "./backend/session-resolver";
import { BackendConfigService } from "./backend/config-service";
import { UserThreadBindingService } from "./thread/user-thread-binding-service";
import { EventPipeline } from "./event/pipeline";
import { AgentEventRouter } from "./event/router";
import { SessionRecoveryService } from "./session/session-recovery-service";
import { SessionStateService } from "./session/session-state-service";
import { PluginService } from "./plugin/plugin-service";
import { ApprovalCallbackHandler } from "./approval/approval-callback-handler";
import { MergeUseCase } from "./merge/merge-service";
import { ApprovalUseCase } from "./approval/approval-use-case";
import { RoleResolver } from "./iam/role-resolver";
import { AuditService } from "./audit/audit-service";
import { BackendService } from "./backend/backend-service";
import type { ProjectRecord } from "./project/app-config";
import { ProjectService, ProjectSetupService, pushProjectWorkBranch } from "./project/project-service";
import { IamService } from "./iam/iam-service";
import { withApiGuards } from "./api-guard";
import { createThreadLayer } from "./thread/create-thread-layer";
import { createTurnLayer } from "./turn/create-turn-layer";
import { createSnapshotLayer } from "./snapshot/create-snapshot-layer";
import type { TurnQueryService } from "./turn/turn-query-service";
import { TurnLifecycleService } from "./turn/turn-lifecycle-service";
import { projectThreadKey } from "./session/session-state-service";

import { OrchestratorError, ErrorCode } from "./errors";
import type { IMOutputMessage } from "./event/im-output";
import type { RouteBinding, ThreadRouteBinding } from "./event/pipeline";
import type { TurnStateSnapshot } from "./turn/turn-state";
import { createGitOps, type GitOps } from "../packages/git-utils/src/index";
import { ALL_BACKEND_SKILL_DIRS } from "./plugin/plugin-paths";

// ── Factory function ────────────────────────────────────────────────────────

export interface OrchestratorLayerDeps {
  config: OrchestratorConfig;
  /** Override transport factories for testing (e.g. injecting FakeAgentBackend). */
  transportFactories?: Record<string, AgentApiFactory>;
  /** Override GitOps for testing (e.g. injecting createFakeGitOps()). */
  gitOps?: GitOps;
}

export async function createOrchestratorLayer(
  deps: OrchestratorLayerDeps
): Promise<OrchestratorLayer> {
  const log = createLogger("orchestrator-factory");
  const { config } = deps;
  const readPositiveIntEnv = (name: string): number | undefined => {
    const raw = process.env[name];
    if (!raw) {
      return undefined;
    }
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) {
      log.warn({ name, raw }, "invalid stream tuning env; ignoring");
      return undefined;
    }
    return value;
  };

  // ── Database + Persistence (L2 owns lifecycle) ──
  const dbPath = process.env.VITEST ? ":memory:" : join(config.dataDir, "collabvibe.db");
  const db = await createDatabase(dbPath);
  const persistence = createPersistenceLayer(db);
  const adminStateStore = persistence.adminStateStore;

  // ── Project resolver ──
  const resolveProjectByChatId = (chatId: string) => {
    const state = adminStateStore.read();
    return state.projects.find((item) => item.chatId === chatId) ?? null;
  };
  const findProjectById = (projectId: string) => {
    const state = adminStateStore.read();
    return state.projects.find((item) => item.id === projectId) ?? null;
  };
  const projectResolver = {
    findProjectByChatId: resolveProjectByChatId,
    findProjectById,
    listActiveProjects: () => {
      const state = adminStateStore.read();
      return state.projects.filter((item) => item.status === "active" && item.chatId);
    }
  };

  const toMergeResult = (
    raw: unknown,
    baseBranch?: string,
  ): MergeResult => {
    if (raw && typeof raw === "object" && "kind" in raw) {
      const kind = (raw as { kind?: string }).kind;
      if (kind === "file_merge_review") {
        return { kind: "review", data: raw as Parameters<typeof toMergeResult>[0] & never };
      }
      if (kind === "merge_result_summary") {
        return { kind: "summary", data: raw as Parameters<typeof toMergeResult>[0] & never };
      }
    }

    if (raw && typeof raw === "object") {
      const candidate = raw as {
        canMerge?: boolean;
        diffStats?: MergeResult extends { kind: "preview"; diffStats: infer T } ? T : never;
        success?: boolean;
        conflicts?: string[];
        message?: string;
        baseBranch?: string;
      };
      if (typeof candidate.canMerge === "boolean") {
        if (candidate.canMerge) {
          return {
            kind: "preview",
            diffStats: candidate.diffStats ?? { additions: 0, deletions: 0, filesChanged: [] },
            baseBranch: candidate.baseBranch ?? baseBranch ?? "main",
          };
        }
        return {
          kind: "conflict",
          conflicts: candidate.conflicts ?? [],
          baseBranch: candidate.baseBranch ?? baseBranch ?? "main",
        };
      }
      if (typeof candidate.success === "boolean") {
        if (candidate.success) {
          return { kind: "success", baseBranch: candidate.baseBranch ?? baseBranch ?? "main", message: candidate.message };
        }
        if (candidate.conflicts?.length) {
          return { kind: "conflict", conflicts: candidate.conflicts, baseBranch: candidate.baseBranch ?? baseBranch ?? "main" };
        }
        return { kind: "rejected", message: candidate.message ?? "merge failed" };
      }
    }

    return { kind: "rejected", message: "unexpected merge result" };
  };

  // ── Backend infrastructure ──
  const backendRegistry = createBackendRegistry();
  const backendConfigService = new BackendConfigService(join(config.dataDir, "config"));
  backendConfigService.ensureLocalConfigs();
  const threadRegistry = persistence.threadRegistry;
  const userThreadBindingService = new UserThreadBindingService(persistence.userThreadBindingRepo);
  const backendSessionResolver = new DefaultBackendSessionResolver(
    backendRegistry, backendConfigService, (projectId, threadName) => {
      return threadRegistry.get(projectId, threadName);
    }
  );
  await backendSessionResolver.ensureSync();

  // ── GitOps: unified git interface for all L2 services ──
  const gitOps = deps.gitOps ?? createGitOps(config.dataDir);

  // ── Plugin service ──
  const pluginService = new PluginService(
    config.cwd,
    persistence.pluginCatalogStore,
    undefined,
    adminStateStore,
    gitOps,
  );

  // ── API pool ──
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
  };
  const runtimeConfigProvider = new DefaultRuntimeConfigProvider(projectResolver, runtimeDefaults);
  const apiFactory = new AgentApiFactoryRegistry(
    deps.transportFactories ?? createDefaultTransportFactories(),
    backendRegistry,
    backendConfigService,
  );
  const apiPool = new DefaultAgentApiPool({ apiFactory });

  // ── Backend service (extracted C5) ──
  const backendService = new BackendService(
    backendSessionResolver,
    backendConfigService,
    (projectId, userId) => threadService.getUserActiveThread(projectId, userId),
  );


  // ── Domain sub-factories (C0a: extracted from orchestrator constructor) ──
  const { threadService, threadRuntimeService, threadUseCaseService } = createThreadLayer({
    threadRegistry,
    userThreadBindingService,
    threadTurnStateRepository: persistence.threadTurnStateRepo,
    turnRepository: persistence.turnRepo,
    agentApiPool: apiPool,
    runtimeConfigProvider,
    backendRegistry,
    backendConfigService,
    pluginService,
    projectResolver,
    gitOps,
  });

  const { turnQueryService, turnCommandService } = createTurnLayer({
    turnRepository: persistence.turnRepo,
    turnDetailRepository: persistence.turnDetailRepo,
    threadService,
    threadRuntimeService,
    projectResolver,
    snapshotRepo: persistence.snapshotRepo,
    pluginService,
    gitOps,
  });

  const { snapshotService } = createSnapshotLayer({
    snapshotRepo: persistence.snapshotRepo,
    turnQueryService,
    threadService,
    threadRuntimeService,
    gitOps,
  });

  // ── Runtime glue ──
  const sessionStateService = new SessionStateService(config.server.approvalTimeoutMs);
  const turnLifecycleService = new TurnLifecycleService({
    sessionStateService,
    threadService,
    threadRuntimeService,
    turnCommandService,
    turnQueryService,
    pluginService,
    runtimeConfigProvider,
    projectResolver,
    threadRegistry,
    gitOps,
  });
  let eventPipeline: EventPipeline | undefined;
  let healthCheckTimer: ReturnType<typeof setInterval> | undefined;

  const getPluginSyncRoots = (projectId?: string): string[] => {
    const roots = new Set<string>();
    if (projectId) {
      const project = projectResolver.findProjectById?.(projectId);
      if (project?.cwd) {
        roots.add(project.cwd);
      }
    }
    if (roots.size === 0) {
      for (const project of projectResolver.listActiveProjects?.() ?? []) {
        if (project.cwd) {
          roots.add(project.cwd);
        }
      }
    }
    if (roots.size === 0) {
      roots.add(config.cwd);
    }
    return [...roots];
  };

  const interruptThread = async (projectId: string, threadName: string, options?: { threadId?: string; turnId?: string }) => {
    try {
      const activeTurnId = options?.turnId ?? await threadService.getActiveTurnId(projectId, threadName);
      if (!activeTurnId) return { interrupted: false };
      const api = await threadRuntimeService.resolveRequiredApi(projectId, threadName);
      const record = threadService.getRecord(projectId, threadName);
      const threadId = options?.threadId ?? record?.threadId;
      if (threadId && api.turnInterrupt) {
        await api.turnInterrupt(threadId, activeTurnId);
        eventPipeline?.markTurnInterrupting({
          projectId,
          threadName,
          threadId,
          turnId: activeTurnId,
        });
      }
      return { interrupted: true };
    } catch {
      return { interrupted: false };
    }
  };

  const mergeTurnPipeline: MergeTurnPipeline = {
    routeMessage: async (projectId: string, message: IMOutputMessage) => {
      if (!eventPipeline) {
        throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, `eventPipeline is not configured for projectId=${projectId}`);
      }
      await eventPipeline.routeMessage(projectId, message);
    },
    prepareTurn: (route: ThreadRouteBinding) => {
      turnLifecycleService.prepareTurnPipeline(route);
    },
    activateTurn: (route: RouteBinding) => {
      turnLifecycleService.activateTurnPipeline(route);
    },
    registerTurnCompleteHook: (projectId: string, threadName: string, hook: (turnId: string) => Promise<void>) => {
      if (!eventPipeline) {
        throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
      }
      eventPipeline.registerTurnCompleteHook(projectId, threadName, hook);
    },
    unregisterTurnCompleteHook: (projectId: string, threadName: string) => {
      if (!eventPipeline) {
        throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
      }
      eventPipeline.unregisterTurnCompleteHook(projectId, threadName);
    },
  };

  const mergeUseCase = new MergeUseCase({
    runtimeConfigProvider,
    projectResolver,
    threadRuntimeService,
    threadService: {
      getRecord: threadService.getRecord.bind(threadService),
      register: threadService.register.bind(threadService),
      updateRecordRuntime: threadService.updateRecordRuntime.bind(threadService),
      markMerged: threadService.markMerged.bind(threadService)
    },
    snapshotRepo: persistence.snapshotRepo,
    mergeSessionRepository: persistence.mergeSessionRepo,
    turnPipeline: mergeTurnPipeline,
    interruptThread,
    gitOps,
  });

  let approvalUseCase: ApprovalUseCase;
  approvalUseCase = new ApprovalUseCase(
    sessionStateService,
    (projectId, threadName) => threadRuntimeService.resolveRequiredApi(projectId, threadName),
  );

  if (pluginService) {
    pluginService.setOnPluginChange(async (event) => {
      const roots = getPluginSyncRoots(event.projectId);
      if (roots.length === 0) return;
      try {
        for (const cwd of roots) {
          const worktrees = await gitOps.worktree.list(cwd);
          for (const wt of worktrees) {
            if (wt.path === cwd) continue;
            for (const dir of ALL_BACKEND_SKILL_DIRS) {
              await gitOps.worktree.ensurePluginSymlink(cwd, wt.path, dir);
            }
          }
        }
      } catch (error) {
        log.warn({
          projectId: event.projectId,
          roots,
          err: error instanceof Error ? error.message : String(error),
        }, "plugin change sync failed");
      }
    });
  }

  const sessionRecoveryService = new SessionRecoveryService({
    projectResolver,
    threadRuntimeService,
    threadService,
    mergeUseCase,
    releaseSessionStateByPrefix: (projectId) => sessionStateService.releaseByPrefix(projectId),
  });

  // ── Supporting services ──
  const approvalHandler = new ApprovalCallbackHandler(
    persistence.approvalStore,
    { applyDecision: approvalUseCase.resume.bind(approvalUseCase) }
  );
  const userRepo = persistence.userRepo;
  userRepo.seedEnvAdmins(config.server.sysAdminUserIds);
  const roleResolver = new RoleResolver(userRepo, adminStateStore);
  const auditService = new AuditService(persistence.auditStore);
  const projectSetupService = new ProjectSetupService(adminStateStore, config, gitOps);
  const projectService = new ProjectService(
    projectSetupService,
    async (projectId) => sessionRecoveryService.onProjectDeactivated(projectId),
    async (projectId) => {
      const { failed, failures } = await sessionRecoveryService.recoverSessions([projectId]);
      if (failed > 0) {
        throw new Error(
          `session recovery after reactivate failed for ${failed} thread(s): ${failures.map((item) => `${item.projectId}/${item.threadName}[${item.category}]: ${item.reason}`).join("; ")}`
        );
      }
    },
    config.cwd,
  );
  const iamService = new IamService(userRepo, adminStateStore, roleResolver);

  const rawApi: OrchestratorApi = {
      async getUserActiveThread(input: { projectId: string; userId: string }) {
        return threadService.getUserActiveThread(input.projectId, input.userId);
      },
      async getThreadRecord(input: { projectId: string; threadName: string }) {
        return threadService.getRecord(input.projectId, input.threadName);
      },
      async createThread(input: {
        projectId: string;
        userId: string;
        threadName: string;
        backendId?: string;
        model?: string;
        profileName?: string;
        serverCmd?: string;
        cwd?: string;
        approvalPolicy?: string;
      }) {
        return threadUseCaseService.createThread(input.projectId, input.userId, input.threadName, {
          backendId: (input.backendId as "codex" | "opencode" | "claude-code" | undefined) ?? "codex",
          model: input.model ?? runtimeDefaults.defaultBackend.model,
          profileName: input.profileName,
          serverCmd: input.serverCmd,
          cwd: input.cwd,
          approvalPolicy: input.approvalPolicy,
        });
      },
      async listThreads(input: { projectId: string; actorId: string }) {
        return threadUseCaseService.listThreadEntries(input.projectId);
      },
      async joinThread(input: { projectId: string; userId: string; threadName: string }) {
        return threadUseCaseService.joinThread(input.projectId, input.userId, input.threadName);
      },
      async leaveThread(input: { projectId: string; userId: string }) {
        return threadUseCaseService.leaveThread(input.projectId, input.userId);
      },
      async deleteThread(input: { projectId: string; threadName: string }) {
        return threadRuntimeService.deleteThread(input.projectId, input.threadName);
      },
      isPendingApproval(input: { projectId: string; threadName: string }) {
        return sessionStateService.hasPendingApproval(projectThreadKey(input.projectId, input.threadName));
      },
      async acceptTurn(input: { projectId: string; turnId: string }) {
        return turnCommandService.acceptTurn(input.projectId, input.turnId);
      },
      async revertTurn(input: { projectId: string; turnId: string }) {
        return turnCommandService.revertTurn(input.projectId, input.turnId);
      },
      async createTurn(input: {
        projectId: string;
        userId: string;
        text: string;
        traceId?: string;
        platform?: "feishu" | "slack";
        messageId?: string;
        mode?: "plan";
      }) {
        const result = await turnLifecycleService.handleUserTextForUser(
          input.projectId,
          input.userId,
          input.text,
          input.traceId,
          {
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.platform ? { platform: input.platform } : {}),
            ...(input.messageId ? { messageId: input.messageId } : {}),
          }
        );
        return { turnId: result.turnId, status: result.status };
      },
      async interruptTurn(input: { projectId: string; userId?: string }) {
        return turnLifecycleService.handleTurnInterrupt(input.projectId, input.userId);
      },
      async respondUserInput(input: { projectId: string; threadName: string; callId: string; answers: Record<string, string[]> }) {
        return threadRuntimeService.respondUserInput(input.projectId, input.threadName, input.callId, input.answers);
      },
      async getTurnDetail(input: { projectId: string; turnId: string }) {
        return turnQueryService.getTurnDetail(input.projectId, input.turnId);
      },
      async getTurnCardData(input: { projectId: string; turnId: string }) {
        return turnQueryService.getTurnCardData(input.projectId, input.turnId);
      },
      async listTurns(input: { projectId: string; limit?: number }) {
        return turnQueryService.listTurns(input.projectId, input.limit);
      },
      async listSnapshots(input: { projectId: string; threadId: string }) {
        return snapshotService.listSnapshots(input.projectId, input.threadId);
      },
      async jumpToSnapshot(input: { projectId: string; targetTurnId: string; userId?: string }) {
        const { snapshot, contextReset } = await snapshotService.jumpToSnapshot(input.projectId, input.targetTurnId, input.userId);
        return { snapshot, contextReset };
      },
      async getSnapshotDiff(input: { projectId: string; userId?: string }) {
        const threadName = input.userId
          ? (await threadService.getUserBinding(input.projectId, input.userId))?.threadName
          : null;
        if (!threadName) {
          return null;
        }
        return snapshotService.getSnapshotDiff(input.projectId, threadName);
      },
      async listAvailableBackends() {
        const backends = await backendService.listAvailableBackends();
        return backends.map((backend) => ({
          ...backend,
          transport: backend.transport === "codex" ? "stdio" as const : "sse" as const,
        }));
      },
      async resolveSession(input: { projectId: string; threadName?: string }) {
        return backendService.resolveSession(input.projectId, input.threadName);
      },
      async getBackendCatalog(input: { projectId: string; userId?: string }) {
        return backendService.getBackendCatalog(input);
      },
      async resolveBackend(input: { projectId: string; threadName?: string }) {
        const session = await backendService.resolveSession(input.projectId, input.threadName);
        return session.backend;
      },
      async readBackendConfigs() {
        return backendService.readBackendConfigs();
      },
      async readBackendPolicy(input: { backendId: string }) {
        return backendService.readBackendPolicy(input.backendId);
      },
      async updateBackendPolicy(input: { backendId: string; key: string; value: string }) {
        backendService.updateBackendPolicy(input.backendId, input.key, input.value);
      },
      async adminAddProvider(input: { backendId: string; providerName: string; baseUrl?: string; apiKeyEnv?: string }) {
        return backendService.adminAddProvider(input.backendId, input.providerName, input.baseUrl, input.apiKeyEnv);
      },
      async adminRemoveProvider(input: { backendId: string; providerName: string }) {
        return backendService.adminRemoveProvider(input.backendId, input.providerName);
      },
      async adminAddModel(input: { backendId: string; providerName: string; modelName: string; modelConfig?: Record<string, unknown> }) {
        return backendService.adminAddModel(input.backendId, input.providerName, input.modelName, input.modelConfig);
      },
      async adminRemoveModel(input: { backendId: string; providerName: string; modelName: string }) {
        return backendService.adminRemoveModel(input.backendId, input.providerName, input.modelName);
      },
      async adminTriggerRecheck(input: { backendId: string; providerName: string }) {
        return backendService.adminTriggerRecheck(input.backendId, input.providerName);
      },
      async adminWriteProfile(input: { backendId: string; profileName: string; model: string; provider: string; extras?: Record<string, unknown> }) {
        return backendService.adminWriteProfile(input.backendId, input.profileName, input.model, input.provider, input.extras);
      },
      async adminDeleteProfile(input: { backendId: string; profileName: string }) {
        return backendService.adminDeleteProfile(input.backendId, input.profileName);
      },
      async handleMerge(input: { projectId: string; branchName: string; force?: boolean; deleteBranch?: boolean; context?: Parameters<typeof mergeUseCase.handleMerge>[3] }) {
        return toMergeResult(await mergeUseCase.handleMerge(
          input.projectId,
          input.branchName,
          { force: input.force, deleteBranch: input.deleteBranch },
          input.context
        ));
      },
      async handleMergePreview(input: { projectId: string; branchName: string; context?: Parameters<typeof mergeUseCase.handleMergePreview>[2] }) {
        return toMergeResult(await mergeUseCase.handleMergePreview(input.projectId, input.branchName, input.context));
      },
      async handleMergeConfirm(input: { projectId: string; branchName: string; deleteBranch?: boolean; context?: Parameters<typeof mergeUseCase.handleMergeConfirm>[3] }) {
        return toMergeResult(await mergeUseCase.handleMergeConfirm(input.projectId, input.branchName, { deleteBranch: input.deleteBranch }, input.context));
      },
      handleMergeReject(input: { projectId: string; branchName: string }) {
        return mergeUseCase.handleMergeReject(input.projectId, input.branchName);
      },
      async startMergeReview(input: { projectId: string; branchName: string; context?: Parameters<typeof mergeUseCase.startMergeReview>[2] }) {
        return toMergeResult(await mergeUseCase.startMergeReview(input.projectId, input.branchName, input.context));
      },
      async getMergeReview(input: { projectId: string; branchName: string }) {
        return toMergeResult(await mergeUseCase.getMergeReview(input.projectId, input.branchName));
      },
      async mergeDecideFile(input: { projectId: string; branchName: string; filePath: string; decision: "accept" | "keep_main" | "use_branch" | "skip"; context?: Parameters<typeof mergeUseCase.mergeDecideFile>[4] }) {
        return toMergeResult(await mergeUseCase.mergeDecideFile(input.projectId, input.branchName, input.filePath, input.decision, input.context));
      },
      async mergeAcceptAll(input: { projectId: string; branchName: string; context?: Parameters<typeof mergeUseCase.mergeAcceptAll>[2] }) {
        return toMergeResult(await mergeUseCase.mergeAcceptAll(input.projectId, input.branchName, input.context));
      },
      async commitMergeReview(input: { projectId: string; branchName: string; context?: Parameters<typeof mergeUseCase.commitMergeReview>[2] }) {
        return toMergeResult(await mergeUseCase.commitMergeReview(input.projectId, input.branchName, input.context));
      },
      async cancelMergeReview(input: { projectId: string; branchName: string; context?: Parameters<typeof mergeUseCase.cancelMergeReview>[2] }) {
        return mergeUseCase.cancelMergeReview(input.projectId, input.branchName, input.context);
      },
      async resolveConflictsViaAgent(input: { projectId: string; branchName: string; prompt?: string; context?: Parameters<typeof mergeUseCase.resolveConflictsViaAgent>[3] }) {
        return toMergeResult(await mergeUseCase.resolveConflictsViaAgent(input.projectId, input.branchName, input.prompt, input.context));
      },
      async retryMergeFile(input: { projectId: string; branchName: string; filePath: string; feedback: string; context?: Parameters<typeof mergeUseCase.retryMergeFile>[4] }) {
        return toMergeResult(await mergeUseCase.retryMergeFile(input.projectId, input.branchName, input.filePath, input.feedback, input.context));
      },
      async retryMergeFiles(input: { projectId: string; branchName: string; filePaths: string[]; feedback: string; context?: Parameters<typeof mergeUseCase.retryMergeFiles>[4] }) {
        return toMergeResult(await mergeUseCase.retryMergeFiles(input.projectId, input.branchName, input.filePaths, input.feedback, input.context));
      },
      async listModelsForBackend(backendId: string) {
        return backendService.listModelsForBackend(backendId);
      },
      async listSkills(projectId?: string) {
        const plugins = await pluginService.getInstallablePlugins(projectId);
        return plugins.map((plugin) => ({
          name: plugin.name ?? plugin.pluginName,
          description: plugin.description,
          installed: plugin.installed,
          enabled: plugin.enabled,
        }));
      },
      async listProjectSkills(projectId: string) {
        return pluginService.listProjectPlugins?.(projectId) ?? [];
      },
      async installSkill(input: { source: string; projectId?: string; userId?: string }) {
        return pluginService.install(input.source, input.projectId, input.userId);
      },
      async removeSkill(input: { name: string; projectId?: string }) {
        if (input.projectId) {
          return pluginService.unbindFromProject?.(input.projectId, input.name) ?? false;
        }
        return pluginService.remove(input.name);
      },
      async bindSkillToProject(input: { projectId: string; skillName: string; actorId: string }) {
        return pluginService.bindToProject?.(input.projectId, input.skillName, "system");
      },
      async unbindSkillFromProject(input: { projectId: string; skillName: string; actorId: string }) {
        return pluginService.unbindFromProject?.(input.projectId, input.skillName) ?? false;
      },
      async installFromLocalSource(input: {
        localPath: string;
        projectId?: string;
        userId?: string;
        pluginName?: string;
      }) {
        return pluginService.installFromLocalSource?.({
          localPath: input.localPath,
          sourceLabel: input.localPath,
          autoEnableProjectId: input.projectId,
          actorId: input.userId ?? "system",
          pluginName: input.pluginName ?? "",
        });
      },
      async inspectLocalSource(input: { localPath: string; sourceType?: string; preferredPluginName?: string; extractionDir?: string }) {
        return pluginService.inspectLocalSource?.({
          localPath: input.localPath,
          sourceType: input.sourceType as never,
          preferredPluginName: input.preferredPluginName,
          extractionDir: input.extractionDir,
        });
      },
      async allocateStagingDir(scope: string, userId: string) {
        return pluginService.allocateStagingDir?.(scope as never, userId) ?? "";
      },
      validateSkillNameCandidate(name: string) {
        return pluginService.validateSkillNameCandidate(name);
      },
      listSkillCatalog() {
        return pluginService.listCatalog().map(entry => ({
          pluginName: entry.pluginName,
          sourceType: entry.sourceType,
          downloadedBy: entry.downloadedBy,
          downloadedAt: entry.downloadedAt,
        }));
      },
      resolveProjectId(chatId: string) {
        return projectService.resolveProjectId(chatId);
      },
      getProjectRecord(projectId: string) {
        return projectService.getProjectRecord(projectId);
      },
      async createProject(input: {
        chatId: string;
        userId: string;
        actorId: string;
        name?: string;
        cwd?: string;
        gitUrl?: string;
        gitToken?: string;
        workBranch?: string;
        initialFiles?: {
          agentsMd?: { encoding: "base64"; contentBase64: string };
          gitignore?: { encoding: "base64"; contentBase64: string };
        };
      }) {
        return projectService.createProject(input);
      },
      async linkProjectToChat(input: { chatId: string; projectId: string; ownerId: string }) {
        return projectService.linkProjectToChat(input);
      },
      async unlinkProject(input: { projectId: string; actorId: string }) {
        return projectService.unlinkProject(input.projectId);
      },
      async disableProject(input: { projectId: string; actorId: string }) {
        return projectService.disableProject(input.projectId);
      },
      async reactivateProject(input: { projectId: string; actorId: string }) {
        return projectService.reactivateProject(input.projectId);
      },
      async deleteProject(input: { projectId: string; actorId: string }) {
        return projectService.deleteProject(input.projectId);
      },
      listProjects() {
        return projectService.listProjects();
      },
      listUnboundProjects() {
        return projectService.listUnboundProjects();
      },
      async updateGitRemote(input: { projectId: string; gitUrl: string }) {
        return projectService.updateGitRemote(input);
      },
      async updateProjectConfig(input: {
        projectId: string;
        workBranch?: string;
        gitUrl?: string;
        gitignoreContent?: string;
        agentsMdContent?: string;
      }) {
        return projectService.updateProjectConfig(input);
      },
      toggleProjectStatus(input: { projectId: string }) {
        return projectSetupService.toggleProjectStatus(input.projectId);
      },
      async checkBackendHealth(_input: { backendId: string; providerName?: string; modelName?: string }) {
        await backendService.runHealthCheck();
        const configs = await backendService.readBackendConfigs();
        const backend = configs.find((item) => item.name === _input.backendId);
        if (!backend) {
          throw new Error(`backend not found: ${_input.backendId}`);
        }
        return {
          backendId: backend.name,
          cmdAvailable: backend.cmdAvailable,
          providers: backend.providers,
        };
      },
      resolveRole(input: { userId: string; projectId?: string }) {
        return iamService.resolveRole(input);
      },
      isAdmin(userId: string) {
        return iamService.isAdmin(userId);
      },
      addAdmin(targetUserId: string) {
        return iamService.addAdmin(targetUserId);
      },
      removeAdmin(targetUserId: string) {
        return iamService.removeAdmin(targetUserId);
      },
      listAdmins() {
        return iamService.listAdmins();
      },
      addProjectMember(input: { projectId: string; userId: string; role: "maintainer" | "developer" | "auditor" }) {
        return iamService.addProjectMember(input);
      },
      removeProjectMember(input: { projectId: string; userId: string }) {
        return iamService.removeProjectMember(input);
      },
      updateProjectMemberRole(input: { projectId: string; userId: string; role: "maintainer" | "developer" | "auditor" }) {
        return iamService.updateProjectMemberRole(input);
      },
      listProjectMembers(projectId: string) {
        return iamService.listProjectMembers(projectId);
      },
      listUsers(input?: { userIds?: string[]; offset?: number; limit?: number }) {
        return iamService.listUsers(input);
      },
      async handleApprovalCallback(input: {
        approvalId: string;
        decision: "accept" | "decline" | "approve_always";
        actorId?: string;
      }) {
        // Route through ApprovalCallbackHandler for audit persistence + dedup
        const context = sessionStateService.turnState.getPendingApproval(input.approvalId);
        if (!context) {
          throw new Error(`invalid approval id: ${input.approvalId}`);
        }
        const mappedAction = input.decision === "accept" ? "approve" as const
          : input.decision === "decline" ? "deny" as const
          : "approve_always" as const;
        const result = await approvalHandler.handle({
          approvalId: input.approvalId,
          approverId: input.actorId ?? context?.userId ?? "system",
          action: mappedAction,
          projectId: context?.projectId,
          threadId: context?.threadId,
          turnId: context?.turnId,
          approvalType: context?.approvalType,
        }, true);
        if (result === "rejected") throw new Error("approval signature invalid");
        return result === "duplicate" || result === "bridge_duplicate" ? "duplicate" as const : "resolved" as const;
      },
      detectStaleThreads(input: { projectId: string; mergedThreadName: string }) {
        return threadRuntimeService.detectStaleThreads(input.projectId, input.mergedThreadName);
      },
      async pushWorkBranch(input: { projectId: string; actorId: string }) {
        return pushProjectWorkBranch(projectResolver, input.projectId, gitOps);
      },
      async configureMergeResolver(input: { projectId: string; branchName: string; backendId: string; model: string }) {
        return mergeUseCase.configureMergeResolver(input.projectId, input.branchName, input.backendId, input.model);
      },
      async installFromGithub(input: {
        repoUrl: string;
        skillSubpath: string;
        pluginName?: string;
        actorId: string;
        description?: string;
        autoEnableProjectId?: string;
      }) {
        const githubInstaller = pluginService as PluginService & {
          installFromGithub?: (params: typeof input) => Promise<{ name: string; description?: string }>;
        };
        return githubInstaller.installFromGithub?.(input) ?? { name: input.pluginName ?? input.repoUrl };
      },
    };
  const api = withApiGuards(rawApi, roleResolver, auditService);

  const finalizeTurnState = async (projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> => {
    await turnCommandService.finalizeTurnState(projectId, turnId, snapshot);
    if (snapshot.content) {
      const record = await turnQueryService.getTurnRecord(projectId, turnId);
      await snapshotService.updateSnapshotSummary(projectId, turnId, snapshot.content.slice(0, 200), record?.filesChanged ?? []);
    }
  };

  const startHealthCheck = (intervalMs = 600_000): void => {
    healthCheckTimer = setInterval(() => {
      backendService.runHealthCheck().catch((error) => {
        log.warn({ err: error instanceof Error ? error.message : error }, "health check failed");
      });
    }, intervalMs);
  };

  const runStartupValidation = (): void => {
    backendService.runHealthCheck().catch((error) => {
      log.warn({ err: error instanceof Error ? error.message : error }, "startup validation failed");
    });
  };

  const stopHealthCheck = (): void => {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer);
      healthCheckTimer = undefined;
    }
  };

  // ── runStartup (deferred — called after platform bootstrap) ──
  async function runStartup(gateway: OutputGateway): Promise<void> {
    // 1. Wire output: event pipeline
    eventPipeline = new EventPipeline(
      new AgentEventRouter((projectId, output) => gateway.dispatch(projectId, output)),
      {
        registerApprovalRequest: approvalUseCase.registerApprovalRequest.bind(approvalUseCase),
        finishTurn: turnLifecycleService.finishTurn.bind(turnLifecycleService),
        ensureTurnStarted: turnLifecycleService.ensureTurnStarted.bind(turnLifecycleService),
        syncTurnState: turnCommandService.syncTurnState.bind(turnCommandService),
        finalizeTurnState,
        onTurnAborted: ({ projectId, threadName, turnId }) =>
          turnLifecycleService.handleTurnAborted(projectId, threadName, turnId),
      },
      {
        streamOutput: {
          persistWindowMs: readPositiveIntEnv("COLLABVIBE_STREAM_PERSIST_WINDOW_MS"),
          persistMaxWaitMs: readPositiveIntEnv("COLLABVIBE_STREAM_PERSIST_MAX_WAIT_MS"),
          persistMaxChars: readPositiveIntEnv("COLLABVIBE_STREAM_PERSIST_MAX_CHARS"),
          uiWindowMs: readPositiveIntEnv("COLLABVIBE_STREAM_UI_WINDOW_MS"),
          uiMaxWaitMs: readPositiveIntEnv("COLLABVIBE_STREAM_UI_MAX_WAIT_MS"),
          uiMaxChars: readPositiveIntEnv("COLLABVIBE_STREAM_UI_MAX_CHARS"),
        }
      }
    );
    turnLifecycleService.setEventPipeline(eventPipeline);
    startHealthCheck();
    runStartupValidation();

    // 2. Backfill missing project metadata
    try {
      const state = adminStateStore.read();
      let dirty = false;
      for (const p of state.projects) {
        if (!p.gitUrl && p.cwd) {
          try {
            const url = await gitOps.repo.getRemoteUrl(p.cwd);
            if (url) { p.gitUrl = url; dirty = true; }
          } catch (error) {
            log.warn({ projectId: p.id, cwd: p.cwd, err: error instanceof Error ? error.message : String(error) }, "startup: getRemoteUrl failed");
          }
        }
        if (!p.defaultBranch && p.cwd) {
          try {
            p.defaultBranch = await gitOps.repo.detectDefaultBranch(p.cwd);
            dirty = true;
          } catch (error) {
            log.warn({ projectId: p.id, cwd: p.cwd, err: error instanceof Error ? error.message : String(error) }, "startup: detectDefaultBranch failed");
            p.defaultBranch = "main";
            dirty = true;
          }
        }
        if (!p.workBranch) {
          p.workBranch = `collabvibe/${p.name}`;
          dirty = true;
        }
        if (!p.createdAt) { p.createdAt = new Date().toISOString(); dirty = true; }
        if (!p.updatedAt) { p.updatedAt = p.createdAt ?? new Date().toISOString(); dirty = true; }
      }
      if (dirty) {
        adminStateStore.write(state);
        log.info("startup: backfilled project gitUrl/defaultBranch/workBranch/timestamps");
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
      const { recovered, failed, failures, mergeFailures } = await sessionRecoveryService.recoverSessions(activeProjectIds);
      if (failed > 0) {
        log.error({ failures, mergeFailures }, "startup: session recovery failures");
        for (const failure of mergeFailures) {
          try {
             const review = await mergeUseCase.getMergeReview(failure.projectId, failure.branchName);
            await gateway.dispatch(failure.projectId, {
              kind: "merge_event",
              data: {
                action: "resolver_done",
                projectId: failure.projectId,
                branchName: failure.branchName,
                review,
              },
            });
          } catch (error) {
            log.warn({
              projectId: failure.projectId,
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
    api,
    runStartup,
    shutdown: async () => {
      stopHealthCheck();
      if (typeof apiPool.releaseAll === "function") {
        await apiPool.releaseAll();
      }
      db.close();
    },
  };
}
