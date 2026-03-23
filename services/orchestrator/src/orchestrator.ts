import { createLogger } from "../../../packages/logger/src/index";
import type { ParsedIntent } from "../../contracts/im/types";
import type { AgentApi, AgentApiPool, ApprovalAwareAgentApi, RuntimeConfig, RuntimeConfigProvider, TurnInputItem } from "../../../packages/agent-core/src/types";
import type { BackendIdentity, BackendId } from "../../../packages/agent-core/src/backend-identity";
import { createBackendIdentity } from "../../../packages/agent-core/src/backend-identity";
import type { BackendRegistry, BackendDefinition } from "./backend/registry";
import type { ThreadListEntryStatus, ThreadRegistry, ThreadRecord } from "./thread/thread-registry";
import type { BackendSessionResolver, AvailableBackend, ResolvedBackendSession } from "./backend/session-resolver";
import type { DefaultBackendSessionResolver } from "./backend/session-resolver";
import type { BackendConfigService, BackendConfigInfo } from "./backend/config-service";
import { ApprovalWaitManager, ConversationStateMachine } from "./session/state-machine";
import type { EventPipeline, RouteBinding, ThreadRouteBinding } from "./event/pipeline";
import { UserThreadBindingService } from "./thread/user-thread-binding-service";
import { ThreadService } from "./thread/thread-service";
import { createSnapshot, restoreSnapshot, diffSnapshot, pinSnapshot, type SnapshotDiff } from "../../../packages/git-utils/src/snapshot";
import { ensurePluginSymlink, listWorktrees } from "../../../packages/git-utils/src/worktree";
import type { PluginService } from "./plugin/plugin-service";
import { ALL_BACKEND_SKILL_DIRS } from "./plugin/index";
import { commitAndDiffWorktreeChanges } from "../../../packages/git-utils/src/commit";
import type { TurnDiffResult } from "../../../packages/git-utils/src/commit";
import type { SnapshotRepository, TurnSnapshotRecord } from "./snapshot/snapshot-types";
import type { ThreadTurnStateRepository } from "./thread/thread-turn-state-repository";
import type { MergeSessionRepository } from "./merge/merge-session-repository";
import { InMemoryThreadTurnStateRepository } from "./thread/thread-turn-state-repository";
import type { TurnRepository } from "./turn/turn-repository";
import { InMemoryTurnRepository } from "./turn/turn-repository";
import type { TurnDetailRepository } from "./turn/turn-detail-repository";
import { InMemoryTurnDetailRepository } from "./turn/turn-detail-repository";
import { TurnQueryService } from "./turn/turn-query-service";
import { TurnCommandService } from "./turn/turn-command-service";
import { SnapshotService } from "./snapshot/snapshot-service";
import { BackendAdminService } from "./backend/backend-admin-service";
import type { TurnDetailAggregate, TurnListItem } from "./turn/turn-types";
import { ResultMode } from "./intent/result";
import type { HandleIntentResult } from "./intent/result";
import { OrchestratorError, ErrorCode } from "./errors";
import type { OrchestratorContext, ProjectThreadKey, TurnSnapshot } from "./orchestrator-context";
import { TurnStateManager } from "./session/turn-state-manager";
import { MergeUseCase } from "./merge/merge-service";
import { ApprovalUseCase } from "./approval/approval-use-case";
import type { ProjectResolver } from "./project/project-resolver";
import type { IMOutputMessage, IMProgressEvent } from "../../contracts/im/im-output";
import type { TurnStateSnapshot } from "../../contracts/im/turn-state";
import { ThreadRuntimeService } from "./thread/thread-runtime-service";
export { TurnSnapshot } from "./orchestrator-context";

/* ── Public types for createThread ── */

export interface CreateThreadOptions {
  backendId: BackendId;
  model: string;
  /** Profile name from data/config (e.g. "default", "5.3-high") */
  profileName?: string;
  serverCmd?: string;
  cwd?: string;
  approvalPolicy?: string;
}

export interface CreateThreadResult {
  threadId: string;
  threadName: string;
  cwd: string;
  api: AgentApi;
}

export interface StaleThreadReport {
  updated: Array<{ threadName: string; oldSha: string; newSha: string }>;
  stale: Array<{ threadName: string; baseSha: string; workBranchHead: string }>;
  errors: Array<{ threadName: string; error: string }>;
}

export interface ThreadListResult {
  threadName: string;
  threadId?: string;
  status: ThreadListEntryStatus;
  backendId: BackendId;
  model: string;
}

export type SessionRecoveryFailureCategory =
  | "CONFIG_ERROR"
  | "BACKEND_SESSION_MISSING"
  | "WORKTREE_MISSING"
  | "SKILL_SYNC_FAILED"
  | "UNKNOWN";

export class ConversationOrchestrator {
  private readonly log = createLogger("orchestrator");
  private readonly agentApiPool: AgentApiPool;
  private readonly runtimeConfigProvider: RuntimeConfigProvider;
  private readonly snapshotRepo?: SnapshotRepository;
  private readonly mergeSessionRepository?: MergeSessionRepository;
  private readonly threadService: ThreadService;
  private readonly turnQueryService: TurnQueryService;
  private readonly turnCommandService: TurnCommandService;
  private readonly snapshotService: SnapshotService;
  private readonly backendAdminService: BackendAdminService;
  private readonly pluginService?: PluginService;
  private readonly cwd?: string;
  private readonly threadRegistry: ThreadRegistry;
  private readonly backendRegistry?: BackendRegistry;
  private readonly backendSessionResolver?: BackendSessionResolver & { reSync?(): Promise<void> };
  private readonly backendConfigService?: BackendConfigService;
  private readonly projectResolver: ProjectResolver;
  private readonly threadRuntimeService: ThreadRuntimeService;
  private readonly approvalTimeoutMs: number;
  private eventPipeline?: EventPipeline;
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  /* ── shared mutable state ── */
  private readonly projectThreadStateMachines = new Map<ProjectThreadKey, ConversationStateMachine>();
  private readonly projectThreadApprovalWaitManagers = new Map<ProjectThreadKey, ApprovalWaitManager>();
  private readonly turnState = new TurnStateManager();

  /* ── delegated use cases ── */
  private readonly mergeUseCase: MergeUseCase;
  private readonly approvalUseCase: ApprovalUseCase;

  private getPluginSyncRoots(projectId?: string): string[] {
    const roots = new Set<string>();
    if (projectId && this.projectResolver?.findProjectById) {
      const project = this.projectResolver.findProjectById(projectId);
      if (project?.cwd) {
        roots.add(project.cwd);
      }
    }
    if (roots.size === 0) {
      for (const project of this.projectResolver?.listActiveProjects?.() ?? []) {
        if (project.cwd) {
          roots.add(project.cwd);
        }
      }
    }
    if (roots.size === 0 && this.cwd) {
      roots.add(this.cwd);
    }
    return [...roots];
  }

  constructor(deps: {
    agentApiPool: AgentApiPool;
    runtimeConfigProvider: RuntimeConfigProvider;
    userThreadBindingService: UserThreadBindingService;
    snapshotRepo?: SnapshotRepository;
    mergeSessionRepository?: MergeSessionRepository;
    turnRepository?: TurnRepository;
    turnDetailRepository?: TurnDetailRepository;
    threadTurnStateRepository?: ThreadTurnStateRepository;
    approvalTimeoutMs?: number;
    pluginService?: PluginService;
    cwd?: string;
    threadRegistry: ThreadRegistry;
    backendRegistry?: BackendRegistry;
    backendSessionResolver?: BackendSessionResolver;
    backendConfigService?: BackendConfigService;
    projectResolver: ProjectResolver;
  }) {
    this.agentApiPool = deps.agentApiPool;
    this.runtimeConfigProvider = deps.runtimeConfigProvider;
    this.snapshotRepo = deps.snapshotRepo;
    this.mergeSessionRepository = deps.mergeSessionRepository;
    const turnRepository = deps.turnRepository ?? new InMemoryTurnRepository();
    const turnDetailRepository = deps.turnDetailRepository ?? new InMemoryTurnDetailRepository();
    const threadTurnStateRepository = deps.threadTurnStateRepository ?? new InMemoryThreadTurnStateRepository();
    this.threadService = new ThreadService(
      deps.threadRegistry,
      deps.userThreadBindingService,
      threadTurnStateRepository,
      this.nowIso.bind(this),
      (projectId, turnId) => turnRepository.getByTurnIdSync(projectId, turnId)?.status,
    );
    this.approvalTimeoutMs = deps.approvalTimeoutMs ?? 30_000;
    this.pluginService = deps.pluginService;
    this.cwd = deps.cwd;
    this.threadRegistry = deps.threadRegistry;
    this.backendRegistry = deps.backendRegistry;
    this.backendSessionResolver = deps.backendSessionResolver;
    this.backendConfigService = deps.backendConfigService;
    this.projectResolver = deps.projectResolver;
    this.threadRuntimeService = new ThreadRuntimeService({
      agentApiPool: this.agentApiPool,
      runtimeConfigProvider: this.runtimeConfigProvider,
      backendRegistry: this.backendRegistry,
      backendConfigService: this.backendConfigService,
      pluginService: this.pluginService,
      threadRegistry: this.threadRegistry,
    });
    const turnServiceDeps = {
      turnRepository,
      turnDetailRepository,
      threadService: this.threadService,
      projectResolver: this.projectResolver,
      nowIso: this.nowIso.bind(this),
    };
    this.turnQueryService = new TurnQueryService(turnServiceDeps);
    this.turnCommandService = new TurnCommandService({
      ...turnServiceDeps,
      snapshotRepo: this.snapshotRepo,
      resolveAgentApi: this.resolveAgentApi.bind(this),
      resolveThreadName: this.resolveThreadName.bind(this),
    });
    this.snapshotService = new SnapshotService(this.snapshotRepo, this.turnQueryService);
    this.backendAdminService = new BackendAdminService(this.backendSessionResolver, this.backendConfigService);

    // Build shared context for use cases
    const ctx: OrchestratorContext = {
      log: this.log,
      threadRuntimeService: this.threadRuntimeService,
      runtimeConfigProvider: this.runtimeConfigProvider,
      snapshotRepo: this.snapshotRepo,
      mergeSessionRepository: this.mergeSessionRepository,
      approvalTimeoutMs: this.approvalTimeoutMs,
      turnState: this.turnState,
      sessionStateMachines: this.projectThreadStateMachines,
      sessionApprovalWaitManagers: this.projectThreadApprovalWaitManagers,
      toProjectThreadKey: this.projectThreadKey.bind(this),
      resolveProjectId: this.requireProjectId.bind(this),
      resolveThreadName: this.resolveThreadName.bind(this),
      resolveAgentApi: this.resolveAgentApi.bind(this),
      getSessionStateMachine: this.getSessionStateMachine.bind(this),
      getApprovalWaitManager: this.getApprovalWaitManager.bind(this),
      ensureCanStartTurn: this.ensureCanStartTurn.bind(this),
      finishSessionTurn: this.finishSessionTurn.bind(this),
      createThread: this.createThread.bind(this),
      getThreadRecord: this.threadService.getRecord.bind(this.threadService),
      markThreadMerged: this.threadService.markMerged.bind(this.threadService),
      routeMessage: async (chatId: string, message: IMOutputMessage) => {
        if (!this.eventPipeline) {
          throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, `eventPipeline is not configured for chatId=${chatId}`);
        }
        await this.eventPipeline.routeMessage(chatId, message);
      },
      registerApprovalRequest: this.registerApprovalRequest.bind(this),
      prepareMergeResolverTurn: (route: ThreadRouteBinding) => {
        this.prepareTurnPipeline(route);
      },
      activateMergeResolverTurn: (route: RouteBinding) => {
        this.activateTurnPipeline(route);
      },
      interruptThread: async (chatId: string, threadName: string) => {
        try {
          const projectId = this.requireProjectId(chatId);
          const activeTurnId = await this.threadService.getActiveTurnId(projectId, threadName);
          if (!activeTurnId) return { interrupted: false };
          const api = await this.resolveAgentApi(chatId, threadName);
          const record = this.threadService.getRecord(projectId, threadName);
          if (record && api.turnInterrupt) {
            await api.turnInterrupt(record.threadId, activeTurnId);
          }
          return { interrupted: true };
        } catch {
          return { interrupted: false };
        }
      },
      registerTurnCompleteHook: (chatId: string, threadName: string, hook: (turnId: string) => Promise<void>) => {
        if (!this.eventPipeline) {
          throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
        }
        this.eventPipeline.registerTurnCompleteHook(chatId, threadName, hook);
      },
    };

    this.mergeUseCase = new MergeUseCase(ctx);
    this.approvalUseCase = new ApprovalUseCase(ctx);

    // Register plugin change callback for worktree symlink sync (C2 fix)
    if (this.pluginService) {
      this.pluginService.setOnPluginChange(async (event) => {
        const roots = this.getPluginSyncRoots(event.projectId);
        if (roots.length === 0) return;
        try {
          for (const cwd of roots) {
            const worktrees = await listWorktrees(cwd);
            for (const wt of worktrees) {
              if (wt.path === cwd) continue; // skip main worktree
              for (const dir of ALL_BACKEND_SKILL_DIRS) {
                await ensurePluginSymlink(cwd, wt.path, dir);
              }
            }
          }
        } catch (error) {
          this.log.warn({
            projectId: event.projectId,
            roots,
            err: error instanceof Error ? error.message : String(error)
          }, "plugin change sync failed");
        }
      });
    }
  }

  /** Late injection to break circular dep: pipeline needs orchestrator callbacks. */
  setEventPipeline(pipeline: EventPipeline): void {
    this.eventPipeline = pipeline;
  }

  /* ── session helpers ── */

  private projectThreadKey(chatId: string, threadName: string): ProjectThreadKey {
    return `${chatId}:${threadName}`;
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  private async resolveThreadName(chatId: string, userId?: string): Promise<string | null> {
    if (!userId) {
      return null;
    }
    const binding = await this.threadService.getUserBinding(this.requireProjectId(chatId), userId);
    return binding?.threadName ?? null;
  }

  private requireProjectId(chatId: string): string {
    const projectId = this.projectResolver.findProjectByChatId(chatId)?.id;
    if (!projectId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found for chatId: ${chatId}`);
    }
    return projectId;
  }

  private getChatIdForProject(projectId: string): string {
    const chatId = this.projectResolver.findProjectById?.(projectId)?.chatId;
    if (!chatId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `chat binding not found for projectId: ${projectId}`);
    }
    return chatId;
  }

  private getSessionStateMachine(projectThreadKey: ProjectThreadKey): ConversationStateMachine {
    let existing = this.projectThreadStateMachines.get(projectThreadKey);
    if (!existing) {
      existing = new ConversationStateMachine();
      this.projectThreadStateMachines.set(projectThreadKey, existing);
    }
    return existing;
  }

  private getApprovalWaitManager(projectThreadKey: ProjectThreadKey): ApprovalWaitManager {
    let existing = this.projectThreadApprovalWaitManagers.get(projectThreadKey);
    if (!existing) {
      existing = new ApprovalWaitManager({ timeoutMs: this.approvalTimeoutMs });
      this.projectThreadApprovalWaitManagers.set(projectThreadKey, existing);
    }
    return existing;
  }

  private ensureCanStartTurn(projectThreadKey: ProjectThreadKey, options?: { allowConcurrentRunning?: boolean }): void {
    const machine = this.getSessionStateMachine(projectThreadKey);
    const state = machine.getState();
    if (state === "AWAITING_APPROVAL") {
      throw new OrchestratorError(ErrorCode.APPROVAL_PENDING, "approval pending: wait for approval decision before sending more messages");
    }
    if (state === "RUNNING" && !options?.allowConcurrentRunning) {
      throw new OrchestratorError(ErrorCode.TURN_ALREADY_RUNNING, "turn already running: wait for current turn to finish");
    }
    if (state !== "RUNNING") {
      machine.transition("RUNNING");
    }
  }

  private finishSessionTurn(projectThreadKey: ProjectThreadKey): void {
    const machine = this.getSessionStateMachine(projectThreadKey);
    if (machine.getState() === "RUNNING") {
      machine.transition("IDLE");
    }
  }

  private releaseFailedStartTurn(projectThreadKey: ProjectThreadKey): void {
    const machine = this.getSessionStateMachine(projectThreadKey);
    const state = machine.getState();
    if (state === "RUNNING") {
      machine.transition("FAILED");
      machine.transition("IDLE");
      return;
    }
    if (state === "FAILED") {
      machine.transition("IDLE");
    }
  }

  private async recoverThreadSession(params: {
    projectId: string;
    chatId: string;
    threadName: string;
    threadRecord: ThreadRecord;
  }): Promise<AgentApi> {
    this.log.info({
      chatId: params.chatId,
      threadName: params.threadName,
      backend: params.threadRecord.backend.backendId,
      model: params.threadRecord.backend.model
    }, "recovering agent API from persisted ThreadRecord");
    const { api } = await this.threadRuntimeService.getOrCreateForExistingThread(params);
    return api;
  }

  private classifyRecoveryFailure(error: unknown): {
    category: SessionRecoveryFailureCategory;
    reason: string;
  } {
    const reason = error instanceof Error ? error.message : String(error);
    const tagged = /^([A-Z_]+):\s*(.*)$/.exec(reason);
    if (tagged) {
      const category = tagged[1] as SessionRecoveryFailureCategory;
      const known = new Set<SessionRecoveryFailureCategory>([
        "CONFIG_ERROR",
        "BACKEND_SESSION_MISSING",
        "WORKTREE_MISSING",
        "SKILL_SYNC_FAILED",
        "UNKNOWN"
      ]);
      if (known.has(category)) {
        return { category, reason: tagged[2] || reason };
      }
    }
    return { category: "UNKNOWN", reason };
  }

  private async resolveAgentApi(chatId: string, threadName: string): Promise<AgentApi> {
    const projectId = this.requireProjectId(chatId);
    const cached = this.threadRuntimeService.getApi(chatId, threadName);
    if (cached) {
      await this.pluginService?.ensureProjectThreadSkills?.(projectId, threadName);
      return cached;
    }
    const record = this.threadService.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, `agent api unavailable for project-thread ${chatId}/${threadName}`);
    }
    throw new OrchestratorError(
      ErrorCode.AGENT_API_UNAVAILABLE,
      `agent api unavailable for project-thread ${chatId}/${threadName}: session not preloaded at startup`
    );
  }

  private async reinitializeEmptyCodexThread(params: {
    projectId: string;
    chatId: string;
    threadName: string;
    oldThreadId: string;
  }): Promise<{ threadId: string }> {
    const record = this.threadService.getRecord(params.projectId, params.threadName);
    if (!record) {
      throw new OrchestratorError(
        ErrorCode.THREAD_NOT_FOUND,
        `thread not found during empty-thread reinit: ${params.threadName}`
      );
    }
    const baseConfig = await this.threadRuntimeService.buildBaseThreadConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: record.backend,
    });
    const config = await this.threadRuntimeService.prepareThreadRuntimeConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      config: baseConfig,
      backendId: record.backend.backendId,
      ensureWorktree: false,
    });
    const api = await this.resolveAgentApi(params.chatId, params.threadName);
    const created = await api.threadStart(config);
    await this.threadService.reinitializeEmptyThread({
      projectId: params.projectId,
      threadName: params.threadName,
      oldThreadId: params.oldThreadId,
      newThreadId: created.thread.id,
      backend: record.backend,
    });
    this.log.warn({
      chatId: params.chatId,
      threadName: params.threadName,
      oldThreadId: params.oldThreadId,
      newThreadId: created.thread.id,
    }, "reinitialized empty codex thread after missing rollout");
    return { threadId: created.thread.id };
  }

  /* ── public facade methods (Phase 2A — IM layer uses these instead of internal services) ── */

  /**
   * Resolve the user's current active thread binding + backend metadata.
   * Unified Thread facade: ThreadService.
   */
  async getUserActiveThread(chatId: string, userId: string): Promise<{
    threadName: string; threadId: string; backend: BackendIdentity;
  } | null> {
    return this.threadService.getUserActiveThread(this.requireProjectId(chatId), userId);
  }

  /**
   * Get a thread's immutable metadata by project-thread identity (resolved from chatId + threadName).
   * Unified Thread facade: ThreadService.
   */
  getThreadRecord(chatId: string, threadName: string): ThreadRecord | null {
    return this.threadService.getRecord(this.requireProjectId(chatId), threadName);
  }

  /**
   * List all available backends (with models).
   * Replaces: deps.backendSessionResolver.listAvailableBackends()
   */
  async listBackends(): Promise<AvailableBackend[]> {
    return this.backendAdminService.listBackends();
  }

  /**
   * List backends with only available models — used by thread new form.
   * Cross-references backendConfigService to filter by model availability.
   */
  async listAvailableBackends(): Promise<AvailableBackend[]> {
    return this.backendAdminService.listAvailableBackends();
  }

  /**
   * Resolve a backend definition by name.
   * Replaces: deps.backendSessionResolver.resolveBackendByName()
   */
  async resolveBackend(name: string): Promise<BackendDefinition | undefined> {
    return this.backendAdminService.resolveBackend(name);
  }

  /**
   * List models (profiles) for a backend.
   * Used by thread creation form for model dropdown.
   */
  async listModelsForBackend(backendId: string): Promise<{ name: string; model: string; modelId: string; provider: string; extras: Record<string, unknown> }[]> {
    return this.backendAdminService.listModelsForBackend(backendId);
  }

  /**
   * Resolve model list for a project-bound chat (optionally for a specific thread).
   * Replaces: deps.backendSessionResolver.resolve()
   */
  async resolveSession(chatId: string, threadName?: string): Promise<ResolvedBackendSession> {
    return this.backendAdminService.resolveSession(chatId, threadName);
  }

  /* ── admin backend management facade ── */

  /** Read all backend configurations (admin panel display) */
  async readBackendConfigs(): Promise<BackendConfigInfo[]> {
    return this.backendAdminService.readBackendConfigs();
  }

  /** Backward-compatible API-key provider add */
  async adminAddProvider(backendName: string, providerName: string, baseUrl?: string, apiKeyEnv?: string, context?: Record<string, unknown>): Promise<void> {
    await this.backendAdminService.adminAddProvider(backendName, providerName, baseUrl, apiKeyEnv, context);
  }

  /** Remove a provider → persist → re-sync registry */
  async adminRemoveProvider(backendName: string, providerName: string): Promise<void> {
    await this.backendAdminService.adminRemoveProvider(backendName, providerName);
  }

  /**
   * Add a model → persist → re-sync registry → fire-and-forget validate.
   * The model appears immediately in readBackendConfigs() with status "checking".
   */
  async adminAddModel(backendName: string, providerName: string, modelName: string, modelConfig?: Record<string, unknown>, context?: Record<string, unknown>): Promise<void> {
    await this.backendAdminService.adminAddModel(backendName, providerName, modelName, modelConfig, context);
  }

  /** Remove a model → persist → re-sync registry */
  async adminRemoveModel(backendName: string, providerName: string, modelName: string): Promise<void> {
    await this.backendAdminService.adminRemoveModel(backendName, providerName, modelName);
  }

  /** Write / update a model profile → persist to data/config/ → fire-and-forget validate */
  adminWriteProfile(backendId: string, profileName: string, model: string, provider: string, extras?: Record<string, unknown>, context?: Record<string, unknown>): void {
    this.backendAdminService.adminWriteProfile(backendId, profileName, model, provider, extras, context);
  }

  /** Delete a model profile */
  adminDeleteProfile(backendId: string, profileName: string): void {
    this.backendAdminService.adminDeleteProfile(backendId, profileName);
  }

  /** Trigger manual recheck — fire-and-forget, marks models as "checking" */
  async adminTriggerRecheck(backendName: string, providerName: string, context?: Record<string, unknown>): Promise<void> {
    await this.backendAdminService.adminTriggerRecheck(backendName, providerName, context);
  }

  /** Read policy fields from a backend's config file */
  async readBackendPolicy(backendName: string): Promise<Record<string, string>> {
    return this.backendAdminService.readBackendPolicy(backendName);
  }

  /** Update a policy field in a backend's config file */
  updateBackendPolicy(backendName: string, field: string, value: string, context?: Record<string, unknown>): void {
    this.backendAdminService.updateBackendPolicy(backendName, field, value, context);
  }

  /* ── health check timer ── */

  /** Start background health check — call from server.ts */
  startHealthCheck(intervalMs = 600_000): void {
    this.healthCheckTimer = setInterval(() => {
      this.runHealthCheck().catch(err => this.log.warn({ err: err instanceof Error ? err.message : err }, "health check failed"));
    }, intervalMs);
  }

  /** Fire-and-forget startup validation — run immediately at server start */
  runStartupValidation(): void {
    this.runHealthCheck()
      .catch(err => this.log.warn({ err: err instanceof Error ? err.message : err }, "startup validation failed"));
  }

  stopHealthCheck(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private async runHealthCheck(): Promise<void> {
    await this.backendAdminService.runHealthCheck();
  }

  /** Re-sync backend config into registry (if resolver supports reSync) */
  private async reSyncRegistry(): Promise<void> {
    await this.backendAdminService.reSyncRegistry();
  }

  /* ── project lifecycle ── */

  /**
   * Called when a project is deactivated (disabled / unbound / deleted / bot removed).
   * Releases all pool entries for this project's bound chatId → kills subprocesses, cleans project-thread session state.
   */
  async onProjectDeactivated(chatId: string): Promise<void> {
    this.log.info({ chatId }, "onProjectDeactivated: releasing sessions");
    await this.threadRuntimeService.releaseByPrefix(chatId);
    for (const key of this.projectThreadStateMachines.keys()) {
      if (key.startsWith(`${chatId}:`)) {
        this.projectThreadStateMachines.delete(key);
        this.projectThreadApprovalWaitManagers.delete(key);
      }
    }
  }

  /**
   * Startup session recovery — eagerly restore all threads for active projects.
   * Called from server.ts before wsApp.start().
   */
  async recoverSessions(activeProjectIds: string[]): Promise<{
    recovered: number;
    failed: number;
    failures: Array<{ projectId: string; chatId: string; threadName: string; category: SessionRecoveryFailureCategory; reason: string }>;
    mergeFailures: Array<{ projectId: string; chatId: string; branchName: string; reason: string }>;
  }> {
    let recovered = 0, failed = 0;
    const failures: Array<{ projectId: string; chatId: string; threadName: string; category: SessionRecoveryFailureCategory; reason: string }> = [];
    const mergeFailures: Array<{ projectId: string; chatId: string; branchName: string; reason: string }> = [];
    const projectIdSet = new Set(activeProjectIds);
    const allThreads = this.threadService.listAllRecords();

    for (const record of allThreads) {
      const recordProjectId = record.projectId;
      if (!recordProjectId) {
        const reason = `thread ${record.threadName} is missing required projectId`;
        this.log.warn({ threadName: record.threadName, threadId: record.threadId }, reason);
        failures.push({ projectId: "", chatId: "", threadName: record.threadName, category: "CONFIG_ERROR", reason });
        failed++;
        continue;
      }
      if (!projectIdSet.has(recordProjectId)) continue;
      const chatId = this.getChatIdForProject(recordProjectId);
      try {
        await this.recoverThreadSession({
          projectId: recordProjectId,
          chatId,
          threadName: record.threadName,
          threadRecord: record,
        });
        recovered++;
      } catch (err) {
        const { category, reason } = this.classifyRecoveryFailure(err);
        this.log.warn({ projectId: recordProjectId, chatId, threadName: record.threadName, category, err: reason },
          "session recovery failed for thread");
        failures.push({ projectId: recordProjectId, chatId, threadName: record.threadName, category, reason });
        failed++;
      }
    }
    const mergeRecovery = await this.mergeUseCase.recoverSessions(activeProjectIds);
    recovered += mergeRecovery.recovered;
    failed += mergeRecovery.failed;
    for (const failure of mergeRecovery.failures) {
      mergeFailures.push(failure);
    }
    this.log.info({ recovered, failed, total: allThreads.length, failures, mergeFailures }, "session recovery complete");
    return { recovered, failed, failures, mergeFailures };
  }

  /* ── thread use cases ── */

  /**
   * Unified thread creation — all callers use this.
   * Performs: config build → worktree → pool create → threadStart → registry → bindings.
   */
  async createThread(
    projectId: string,
    chatId: string,
    userId: string,
    threadName: string,
    options: CreateThreadOptions
  ): Promise<CreateThreadResult> {


    // 1. Build BackendIdentity and reserve thread name before any side effects.
    const backend = createBackendIdentity(options.backendId, options.model);
    let reservation;
    try {
      reservation = this.threadService.reserve({
        projectId,
        threadName,
        backend,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.startsWith("THREAD_ALREADY_EXISTS:")) {
        throw error;
      }
      const existing = this.threadService.getRecord(projectId, threadName);
      const suffix = existing ? ` (ID: ${existing.threadId.slice(0, 8)})` : "";
      throw new OrchestratorError(
        ErrorCode.THREAD_ALREADY_EXISTS,
        `Thread "${threadName}" 已存在${suffix}，请直接使用或选择其他名称`
      );
    }

    let api: AgentApi | undefined;
    try {
      let mcpServers: RuntimeConfig["mcpServers"] | undefined;
      if (this.pluginService) {
        try {
          const collected = await this.pluginService.collectMcpServers(projectId);
          if (collected.length > 0) {
            mcpServers = collected.map(s => ({
              name: s.name,
              command: s.command,
              args: s.args,
              env: s.env,
            }));
          }
        } catch (error) {
          this.log.warn({
            projectId,
            threadName,
            err: error instanceof Error ? error.message : String(error)
          }, "collectMcpServers failed; continuing without MCP servers");
        }
      }

      const runtime = await this.threadRuntimeService.createForNewThread({
        projectId,
        chatId,
        threadName,
        backend,
        backendId: options.backendId,
        profileName: options.profileName,
        overrides: {
          cwd: options.cwd,
          approvalPolicy: options.approvalPolicy,
          profileName: options.profileName,
        },
        mcpServers,
      });
      const { config } = runtime;

      // 4. Create API session via pool (using pre-built config)
      api = runtime.api;

      // 5. threadStart
      const created = await api.threadStart(config);

      // 6. Activate reserved ThreadRecord (project-level, immutable)
      this.threadService.activate(reservation.reservationId, {
        projectId,
        threadName,
        threadId: created.thread.id,
        backend,
      });

      // 7. Bind UserThreadBinding (pure pointer)
      await this.threadService.bindUserToThread(projectId, userId, threadName, created.thread.id);
      this.log.info({ chatId, threadName, threadId: created.thread.id, backend: backend.backendId, model: backend.model }, "thread created");
      return { threadId: created.thread.id, threadName, cwd: config.cwd ?? "", api };
    } catch (error) {
      this.threadService.release(reservation.reservationId);
      if (api) {
        try {
          await this.threadRuntimeService.releaseThread(chatId, threadName);
        } catch (releaseError) {
          this.log.warn({
            chatId,
            threadName,
            err: releaseError instanceof Error ? releaseError.message : String(releaseError)
          }, "releaseThread failed during createThread cleanup");
        }
      }
      throw error;
    }
  }

  async handleThreadJoin(chatId: string, userId: string, threadName: string): Promise<{ threadId: string; threadName: string }> {
    const projectId = this.requireProjectId(chatId);
    const record = this.threadService.getRecord(projectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.THREAD_NOT_FOUND, `thread not found: ${threadName}`);
    }
    // UserThreadBinding is a pure pointer — just store threadName + threadId
    await this.threadService.bindUserToThread(projectId, userId, threadName, record.threadId);
    return { threadId: record.threadId, threadName };
  }

  async handleThreadLeave(chatId: string, userId: string): Promise<void> {
    await this.threadService.leaveUserThread(this.requireProjectId(chatId), userId);
  }

  async handleThreadList(chatId: string): Promise<Array<{ threadName: string; threadId: string }>> {
    return this.threadService.listRecords(this.requireProjectId(chatId)).map((r) => ({
      threadName: r.threadName,
      threadId: r.threadId,
    }));
  }

  async handleThreadListEntries(chatId: string): Promise<ThreadListResult[]> {
    return this.threadService.listEntries(this.requireProjectId(chatId)).map((entry) => ({
      threadName: entry.threadName,
      threadId: entry.threadId,
      status: entry.status,
      backendId: entry.backend.backendId,
      model: entry.backend.model,
    }));
  }

  /* ── turn use cases ── */

  async handleUserTextForUser(
    projectId: string, chatId: string, userId: string, text: string, traceId?: string,
    options?: { mode?: "plan" }
  ): Promise<{ threadId: string; turnId: string }> {
    const projectIdResolved = this.requireProjectId(chatId);
    const binding = await this.threadService.getUserBinding(projectIdResolved, userId);
    if (!binding) {
      throw new OrchestratorError(ErrorCode.NO_ACTIVE_THREAD, "请先 /thread new 或 /thread join");
    }

    const projectThreadKey = this.projectThreadKey(chatId, binding.threadName);
    this.ensureCanStartTurn(projectThreadKey);
    try {
      await this.pluginService?.ensureProjectThreadSkills?.(projectIdResolved, binding.threadName);

      const api = await this.resolveAgentApi(chatId, binding.threadName);

      // Plan mode — switch agent to plan mode before turn
      if (options?.mode === "plan" && api.setMode) {
        await api.setMode("plan");
      }

      const turnRouteBase = {
        chatId,
        userId,
        traceId,
        threadName: binding.threadName,
        threadId: binding.threadId,
        turnMode: options?.mode === "plan" ? "plan" : undefined
      } satisfies ThreadRouteBinding;

      const makeTurnParams = (threadId: string) => {
        const input: TurnInputItem[] = [];
        // Parse $skill-name references from text
        const skillPattern = /\$([a-zA-Z0-9_-]+)/g;
        let match: RegExpExecArray | null;
        const skillRefs: string[] = [];
        while ((match = skillPattern.exec(text)) !== null) {
          skillRefs.push(match[1]!);
        }
        // Add skill input items for each reference (resolved from canonical store)
        if (this.pluginService && skillRefs.length > 0) {
          const allowedSkillNames = new Set(
            (this.pluginService.listProjectBindings?.(projectIdResolved) ?? []).map((binding) => binding.pluginName)
          );
          const canonicalStore = this.pluginService.getCanonicalStorePath();
          for (const name of skillRefs) {
            if (!allowedSkillNames.has(name)) continue;
            const skillPath = `${canonicalStore}/${name}`;
            input.push({ type: "skill", name, path: skillPath });
          }
        }
        // Add the text itself
        input.push({ type: "text", text });
        const params: { threadId: string; traceId?: string; input: TurnInputItem[] } = {
          threadId, input
        };
        if (traceId) params.traceId = traceId;
        return params;
      };

      let turn: { turn: { id: string } };
      let activeThreadId = binding.threadId;
      try {
        const started = await this.runTurnWithLifecycle(
          { ...turnRouteBase, threadId: activeThreadId },
          async () => {
            const turnResult = await api.turnStart(makeTurnParams(activeThreadId));
            return { turnId: turnResult.turn.id, value: turnResult };
          }
        );
        turn = started.value;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes("thread not found") || errMsg.includes("not found")) {
          this.log.info({ threadId: activeThreadId }, "thread lost, auto-resuming");
          const runtimeConfig = await this.runtimeConfigProvider.getProjectRuntimeConfig(projectId, userId);
          if (!api.threadResume) throw new OrchestratorError(ErrorCode.RESUME_NOT_SUPPORTED, "thread lost and backend does not support resume");
          let resumed;
          try {
            resumed = await api.threadResume(activeThreadId, runtimeConfig);
          } catch (resumeError) {
            const resumeMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            if (resumeMsg.includes("no rollout found for thread id")) {
              const runtimeState = await this.threadService.getRuntimeState(projectIdResolved, binding.threadName);
              if (!runtimeState?.lastCompletedTurnId) {
                const record = this.threadService.getRecord(projectIdResolved, binding.threadName);
                if (record?.backend.backendId === "codex") {
                  const recreated = await this.reinitializeEmptyCodexThread({
                    projectId: projectIdResolved,
                    chatId,
                    threadName: binding.threadName,
                    oldThreadId: activeThreadId,
                  });
                  activeThreadId = recreated.threadId;
                  const started = await this.runTurnWithLifecycle(
                    { ...turnRouteBase, threadId: activeThreadId },
                    async () => {
                      const turnResult = await api.turnStart(makeTurnParams(activeThreadId));
                      return { turnId: turnResult.turn.id, value: turnResult };
                    }
                  );
                  turn = started.value;
                  return { threadId: activeThreadId, turnId: turn.turn.id };
                }
              }
              throw new OrchestratorError(
                ErrorCode.RESUME_NOT_SUPPORTED,
                `thread ${binding.threadName} 无法恢复：当前后端会话存储中未找到 rollout；若刚调整过 CODEX_HOME/工作目录，请新建 thread`,
                { threadId: activeThreadId, threadName: binding.threadName }
              );
            }
            throw resumeError;
          }
          const resumedThreadId = resumed.thread.id;
          if (resumedThreadId !== activeThreadId) {
            this.log.warn({ old: activeThreadId, new: resumedThreadId }, "resume returned different ID, re-binding");
            activeThreadId = resumedThreadId;
            throw new OrchestratorError(
              ErrorCode.RESUME_NOT_SUPPORTED,
              `thread resume returned a new thread id for ${binding.threadName}; refusing to mutate ThreadRecord identity`
            );
          }
          const started = await this.runTurnWithLifecycle(
            { ...turnRouteBase, threadId: activeThreadId },
            async () => {
              const turnResult = await api.turnStart(makeTurnParams(activeThreadId));
              return { turnId: turnResult.turn.id, value: turnResult };
            }
          );
          turn = started.value;
        } else {
          throw error;
        }
      }
      return { threadId: activeThreadId, turnId: turn.turn.id };
    } catch (error) {
      this.releaseFailedStartTurn(projectThreadKey);
      throw error;
    }
  }

  private getPipelineApi(route: ThreadRouteBinding): AgentApi {
    const api = this.threadRuntimeService.getApi(route.chatId, route.threadName);
    if (!api) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `pipeline agent api not found: chatId=${route.chatId} threadName=${route.threadName}`
      );
    }
    if (!api.onNotification) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `pipeline agent api.onNotification is missing: chatId=${route.chatId} threadName=${route.threadName}`
      );
    }
    return api;
  }

  private prepareTurnPipeline(route: ThreadRouteBinding): void {
    if (!this.eventPipeline) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
    }
    const api = this.getPipelineApi(route);
    this.eventPipeline.attachSource(api as Parameters<typeof this.eventPipeline.attachSource>[0], route);
    this.eventPipeline.prepareTurn(route);
  }

  private activateTurnPipeline(route: RouteBinding): void {
    if (!this.eventPipeline) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
    }
    const api = this.getPipelineApi(route);
    this.eventPipeline.attachSource(api as Parameters<typeof this.eventPipeline.attachSource>[0], route);
    this.eventPipeline.activateTurn(route);
  }

  private async runTurnWithLifecycle<T>(
    route: ThreadRouteBinding,
    startTurn: () => Promise<{ turnId: string; value: T }>
  ): Promise<{ turnId: string; value: T }> {
    this.prepareTurnPipeline(route);
    const started = await startTurn();
    this.activateTurnPipeline({ ...route, turnId: started.turnId });
    return started;
  }

  getConversationState(chatId: string, threadIdOrUserId?: string): string {
    return this.getSessionStateMachine(this.projectThreadKey(chatId, threadIdOrUserId ?? "__default__")).getState();
  }

  async finishTurn(chatId: string, _threadId: string, options?: { threadName?: string }): Promise<TurnDiffResult | null> {
    if (!options?.threadName) {
      throw new Error(`finishTurn requires threadName: chatId=${chatId} threadId=${_threadId}`);
    }
    const key = this.projectThreadKey(chatId, options.threadName);
    this.finishSessionTurn(key);
    const turn = await this.turnQueryService.getActiveTurnRecord(chatId, options.threadName);
    if (!turn) return null;
    const turnId = turn.turnId;
    const worktreePath = turn.cwd;
    const traceId = turn.traceId;
    const diff = await commitAndDiffWorktreeChanges(
      worktreePath,
      `[codex] turn ${turnId} changes`,
      {
        chatId,
        threadId: _threadId,
        threadName: options.threadName,
        turnId,
        traceId
      }
    );
    if (diff) {
      this.log.info({ chatId, threadId: _threadId, threadName: options.threadName, turnId, traceId, files: diff.filesChanged.length }, "finishTurn: committed with diff");
      // Mark thread as diverged so stale detection knows it needs manual sync
      try {
        const projectId = this.requireProjectId(chatId);
        this.threadRegistry.update?.(projectId, options.threadName, { hasDiverged: true });
      } catch { /* non-critical */ }
    }
    await this.turnCommandService.completeActiveTurn(chatId, options.threadName, diff);
    return diff;
  }

  /* ── thread runtime facade ── */

  isPendingApproval(chatId: string, threadName: string): boolean {
    return this.threadService.isPendingApproval(this.requireProjectId(chatId), threadName);
  }

  /* ── snapshot / history ── */

  async recordTurnStart(projectId: string, chatId: string, threadName: string, threadId: string, turnId: string, cwd: string, userId?: string, traceId?: string): Promise<{ turnNumber: number }> {
    return this.turnCommandService.recordTurnStart({ projectId, chatId, threadName, threadId, turnId, cwd, userId, traceId });
  }

  async handleTurnInterrupt(chatId: string, userId?: string): Promise<{ interrupted: boolean }> {
    const threadName = await this.resolveThreadName(chatId, userId);
    if (!threadName) return { interrupted: false };
    const key = this.projectThreadKey(chatId, threadName);
    const result = await this.turnCommandService.interruptTurn(chatId, userId);
    const machine = this.getSessionStateMachine(key);
    if (result.interrupted && (machine.getState() === "RUNNING" || machine.getState() === "AWAITING_APPROVAL")) {
      machine.transition("INTERRUPTED");
    }
    return result;
  }

  async handleRollback(chatId: string, userId?: string, options?: { threadName?: string }): Promise<{ rolledBack: boolean }> {
    const threadName = options?.threadName ?? await this.resolveThreadName(chatId, userId);
    if (!threadName) return { rolledBack: false };
    const turnId = await this.threadService.getLastCompletedTurnId(this.requireProjectId(chatId), threadName);
    if (!turnId) return { rolledBack: false };
    return this.revertTurn(chatId, turnId);
  }

  async acceptTurn(chatId: string, turnId: string): Promise<{ accepted: boolean }> {
    return this.turnCommandService.acceptTurn(chatId, turnId);
  }

  async revertTurn(chatId: string, turnId: string): Promise<{ rolledBack: boolean }> {
    return this.turnCommandService.revertTurn(chatId, turnId);
  }

  async getSnapshotDiff(chatId: string, userId?: string): Promise<SnapshotDiff | null> {
    const threadName = await this.resolveThreadName(chatId, userId);
    if (!threadName) return null;
    return this.snapshotService.getSnapshotDiff(chatId, threadName);
  }

  async listSnapshots(chatId: string, threadId: string): Promise<TurnSnapshotRecord[]> {
    return this.snapshotService.listSnapshots(this.requireProjectId(chatId), threadId);
  }

  async jumpToSnapshot(chatId: string, targetTurnId: string, userId?: string): Promise<{ snapshot: TurnSnapshotRecord; contextReset: boolean }> {
    const projectId = this.requireProjectId(chatId);
    const { snapshot: target, latestIndex } = await this.snapshotService.jumpToSnapshot(projectId, targetTurnId);
    const numTurns = latestIndex - target.turnIndex + 1;
    let contextReset = false;
    if (numTurns > 0) {
      const threadName = await this.resolveThreadName(chatId, userId);
      if (threadName) {
        const api = await this.resolveAgentApi(chatId, threadName);
        if (api.threadRollback) {
          try {
            await api.threadRollback(target.threadId, numTurns);
          } catch (error) {
            this.log.warn({
              chatId,
              threadName,
              threadId: target.threadId,
              turns: numTurns,
              err: error instanceof Error ? error.message : String(error)
            }, "threadRollback failed; UI should surface context reset");
            contextReset = true;
          }
        }
      }
    }
    return { snapshot: target, contextReset };
  }

  async updateSnapshotSummary(chatId: string, turnId: string, summary: string, files: string[]): Promise<void> {
    await this.snapshotService.updateSnapshotSummary(this.requireProjectId(chatId), chatId, turnId, summary, files);
  }

  async updateTurnSummary(chatId: string, turnId: string, summary: {
    lastAgentMessage?: string;
    tokenUsage?: { input: number; output: number; total?: number };
    filesChanged?: string[];
  }): Promise<void> {
    await this.turnCommandService.updateTurnSummary(chatId, turnId, summary);
  }

  async updateTurnMetadata(chatId: string, turnId: string, patch: {
    promptSummary?: string;
    backendName?: string;
    modelName?: string;
    turnMode?: "plan";
  }): Promise<void> {
    if (this.eventPipeline) {
      const updated = await this.eventPipeline.updateTurnMetadata(chatId, turnId, patch);
      if (updated) {
        return;
      }
    }
    await this.turnCommandService.updateTurnMetadata(chatId, turnId, patch);
  }

  async appendTurnEvent(chatId: string, message: IMOutputMessage): Promise<void> {
    await this.turnCommandService.appendTurnEvent(chatId, message);
  }

  async syncTurnState(chatId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> {
    await this.turnCommandService.syncTurnState(chatId, turnId, snapshot);
  }

  async finalizeTurnState(chatId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void> {
    await this.turnCommandService.finalizeTurnState(chatId, turnId, snapshot);
    if (snapshot.content) {
      const record = await this.turnQueryService.getTurnRecord(chatId, turnId);
      await this.updateSnapshotSummary(chatId, turnId, snapshot.content.slice(0, 200), record?.filesChanged ?? []);
    }
  }

  async getTurnDetail(chatId: string, turnId: string): Promise<TurnDetailAggregate> {
    return this.turnQueryService.getTurnDetail(chatId, turnId);
  }

  async getTurnCardData(chatId: string, turnId: string): Promise<import("../../contracts/im/turn-card-data-provider").TurnCardData | null> {
    const record = await this.turnQueryService.getTurnRecord(chatId, turnId);
    if (!record) return null;
    let detail: import("./turn/turn-detail-record").TurnDetailRecord | null = null;
    try {
      const agg = await this.turnQueryService.getTurnDetail(chatId, turnId);
      detail = agg.detail;
    } catch { /* detail may be missing for old turns */ }
    const fileChanges: Array<{ filesChanged: string[]; diffSummary: string; stats?: { additions: number; deletions: number } }> = [];
    if (record.filesChanged && record.filesChanged.length > 0) {
      fileChanges.push({ filesChanged: record.filesChanged, diffSummary: record.diffSummary ?? "", stats: record.stats });
    }
    return {
      chatId: record.chatId,
      turnId: record.turnId,
      threadName: record.threadName,
      turnNumber: record.turnNumber,
      backendName: detail?.backendName,
      modelName: detail?.modelName,
      message: detail?.message ?? record.lastAgentMessage,
      reasoning: detail?.reasoning,
      turnMode: detail?.turnMode,
      tools: detail?.tools ?? [],
      toolOutputs: detail?.toolOutputs ?? [],
      planState: detail?.planState,
      promptSummary: detail?.promptSummary,
      agentNote: detail?.agentNote,
      fileChanges,
      tokenUsage: record.tokenUsage,
      status: record.status,
    };
  }

  async listTurns(chatId: string, limit = 20): Promise<TurnListItem[]> {
    return this.turnQueryService.listTurns(chatId, limit);
  }

  /* ── approval (delegated) ── */

  registerApprovalRequest(params: Parameters<ApprovalUseCase["registerApprovalRequest"]>[0]): void {
    this.approvalUseCase.registerApprovalRequest(params);
  }

  handleApprovalDecision(approvalId: string, decision: "accept" | "decline" | "approve_always"): Promise<"resolved" | "duplicate"> {
    return this.approvalUseCase.handleApprovalDecision(approvalId, decision);
  }

  resume(approvalId: string, action: "approve" | "deny" | "approve_always"): Promise<"resolved" | "duplicate"> {
    return this.approvalUseCase.resume(approvalId, action);
  }

  /** Respond to a user input request — find the API via threadName lookup and delegate. */
  async respondUserInput(chatId: string, threadName: string, callId: string, answers: Record<string, string[]>): Promise<void> {
    const api = this.threadRuntimeService.getApi(chatId, threadName);
    if (!api?.respondUserInput) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "No active agent supporting user input response");
    }
    await api.respondUserInput({ callId, answers });
  }

  /* ── merge (delegated) ── */

  onResolverComplete(handler: Parameters<MergeUseCase["onResolverComplete"]>[0]): void {
    this.mergeUseCase.onResolverComplete(handler);
  }

  handleMergeDryRun(projectId: string, chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.handleMergeDryRun(projectId, chatId, branchName, context);
  }

  handleMergeConfirm(chatId: string, branchName: string, options?: { deleteBranch?: boolean }, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.handleMergeConfirm(chatId, branchName, options, context);
  }

  handleMergeReject(chatId: string, branchName: string): void {
    this.mergeUseCase.handleMergeReject(chatId, branchName);
  }

  handleMergeWithConflictResolver(projectId: string, chatId: string, branchName: string, conflicts: string[], userId?: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.handleMergeWithConflictResolver(projectId, chatId, branchName, conflicts, userId, context);
  }

  handleMergePreview(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.handleMergePreview(chatId, branchName, context);
  }

  handleMerge(projectId: string, chatId: string, branchName: string, options?: { force?: boolean; deleteBranch?: boolean }, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.handleMerge(projectId, chatId, branchName, options, context);
  }
  // ── Push facade ────────────────────────────────────────────────────────

  async pushWorkBranch(projectId: string): Promise<void> {
    const project = this.projectResolver?.findProjectById?.(projectId);
    if (!project) {
      throw new Error(`pushWorkBranch: project not found: ${projectId}`);
    }
    if (!project.gitUrl) {
      throw new Error(`pushWorkBranch: project has no gitUrl configured: ${projectId}`);
    }
    if (!project.workBranch) {
      throw new Error(`pushWorkBranch: project has no workBranch configured: ${projectId}`);
    }
    const { pushBranch } = await import("../../../packages/git-utils/src/index");
    await pushBranch(project.cwd, project.workBranch);
  }

  // ── Thread lifecycle facade ───────────────────────────────────────────

  /**
   * Delete a thread: release backend session, remove worktree, unregister from registry.
   * Used when user clicks "delete thread" after merge success.
   * Each step is individually error-tolerant (non-critical cleanup path, §7).
   */
  async deleteThread(projectId: string, chatId: string, threadName: string): Promise<void> {
    const log = (await import("../../../packages/logger/src/index")).createLogger("orchestrator");

    // 1. Release backend session (kill process)
    try {
      await this.threadRuntimeService.releaseThread(chatId, threadName);
    } catch (err) {
      log.error({ err, projectId, chatId, threadName }, "deleteThread: releaseThread failed");
    }

    // 2. Remove worktree
    try {
      const project = this.projectResolver?.findProjectById?.(projectId);
      if (project?.cwd) {
        const { removeWorktree, getWorktreePath } = await import("../../../packages/git-utils/src/index");
        const worktreePath = getWorktreePath(project.cwd, threadName);
        await removeWorktree(project.cwd, worktreePath, threadName);
      }
    } catch (err) {
      log.error({ err, projectId, threadName }, "deleteThread: removeWorktree failed");
    }

    // 3. Unregister from thread registry
    try {
      this.threadService.markMerged(projectId, threadName);
    } catch (err) {
      log.error({ err, projectId, threadName }, "deleteThread: markMerged failed");
    }
  }

  /**
   * After a successful merge, detect stale threads in the project.
   * Compares each thread's baseSha vs the current workBranch HEAD.
   *
   * - Equal → up-to-date, skip
   * - Not equal + hasDiverged=false → auto fast-forward worktree + update baseSha
   * - Not equal + hasDiverged=true → flag as stale (needs manual /sync)
   *
   * Each thread is processed independently; errors are logged but don't fail the operation (§7).
   */
  async detectStaleThreads(projectId: string, mergedThreadName: string): Promise<StaleThreadReport> {
    const log = (await import("../../../packages/logger/src/index")).createLogger("orchestrator");
    const { getHeadSha, fastForwardWorktree, getWorktreePath } = await import("../../../packages/git-utils/src/index");

    const project = this.projectResolver?.findProjectById?.(projectId);
    if (!project?.cwd) {
      log.warn({ projectId }, "detectStaleThreads: project or cwd not found");
      return { updated: [], stale: [], errors: [] };
    }

    // Get the current workBranch HEAD (this is the post-merge state)
    let workBranchHead: string;
    try {
      workBranchHead = await getHeadSha(project.cwd);
    } catch (err) {
      log.error({ err, projectId }, "detectStaleThreads: getHeadSha failed");
      return { updated: [], stale: [], errors: [] };
    }

    const allThreads = this.threadRegistry.list(projectId);
    const report: StaleThreadReport = { updated: [], stale: [], errors: [] };

    for (const thread of allThreads) {
      // Skip the just-merged thread
      if (thread.threadName === mergedThreadName) continue;
      // Skip threads without baseSha (legacy threads without tracking)
      if (!thread.baseSha) continue;
      // Skip threads already up-to-date
      if (thread.baseSha === workBranchHead) continue;

      try {
        if (!thread.hasDiverged) {
          // Safe to auto fast-forward
          const worktreePath = thread.worktreePath ?? getWorktreePath(project.cwd, thread.threadName);
          const newSha = await fastForwardWorktree(worktreePath, project.workBranch);
          this.threadRegistry.update?.(projectId, thread.threadName, {
            baseSha: newSha,
          });
          report.updated.push({ threadName: thread.threadName, oldSha: thread.baseSha, newSha });
          log.info({ projectId, threadName: thread.threadName, oldSha: thread.baseSha, newSha }, "auto fast-forwarded thread");
        } else {
          // Has diverged commits — needs manual sync
          report.stale.push({ threadName: thread.threadName, baseSha: thread.baseSha, workBranchHead });
          log.info({ projectId, threadName: thread.threadName, baseSha: thread.baseSha, workBranchHead }, "thread is stale (has diverged)");
        }
      } catch (err) {
        log.error({ err, projectId, threadName: thread.threadName }, "detectStaleThreads: processing thread failed");
        report.errors.push({ threadName: thread.threadName, error: String(err) });
      }
    }

    return report;
  }

  startMergeReview(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.startMergeReview(chatId, branchName, context);
  }

  getMergeReview(chatId: string, branchName: string) {
    return this.mergeUseCase.getMergeReview(chatId, branchName);
  }

  mergeDecideFile(chatId: string, branchName: string, filePath: string, decision: "accept" | "keep_main" | "use_branch" | "skip", context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.decideFile(chatId, branchName, filePath, decision, context);
  }

  mergeAcceptAll(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.acceptAllRemaining(chatId, branchName, context);
  }

  commitMergeReview(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.commitMergeReview(chatId, branchName, context);
  }

  cancelMergeReview(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.cancelMergeReview(chatId, branchName, context);
  }

  resolveConflictsViaAgent(chatId: string, branchName: string, prompt?: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.resolveConflictsViaAgent(chatId, branchName, prompt, context);
  }

  configureMergeResolver(chatId: string, branchName: string, backendId: string, model: string) {
    return this.mergeUseCase.configureMergeResolver(chatId, branchName, backendId, model);
  }

  retryMergeFile(chatId: string, branchName: string, filePath: string, feedback: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.retryFileWithAgent(chatId, branchName, filePath, feedback, context);
  }

  retryMergeFiles(chatId: string, branchName: string, filePaths: string[], feedback: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string; resolverName?: string }) {
    return this.mergeUseCase.retryFilesWithAgent(chatId, branchName, filePaths, feedback, context);
  }

  /* ── intent routing ── */

  async handleIntent(
    projectId: string, chatId: string, intent: ParsedIntent, text: string, traceId?: string, userId?: string
  ): Promise<HandleIntentResult> {
    if (intent.intent !== "TURN_START") {
      throw new OrchestratorError(
        ErrorCode.UNSUPPORTED_INTENT,
        `unsupported agent intent: ${intent.intent}`
      );
    }
    return this.handleIntentTurnStart(projectId, chatId, text, traceId, userId);
  }

  private async handleIntentTurnStart(
    projectId: string, chatId: string, text: string, traceId?: string, userId?: string,
    options?: { mode?: "plan" }
  ): Promise<HandleIntentResult> {
    if (!userId) {
      throw new OrchestratorError(ErrorCode.NO_ACTIVE_THREAD, "请先 /thread new 或 /thread join");
    }

    // /push — push workBranch to remote
    const pushMatch = /^\s*\/push(?:\s|$)/.exec(text);
    if (pushMatch) {
      try {
        await this.pushWorkBranch(projectId);
        return { mode: ResultMode.THREAD_SYNC_TEXT, id: "push", text: "✅ workBranch 已推送到远程。" };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { mode: ResultMode.THREAD_SYNC_TEXT, id: "push", text: `❌ 推送失败: ${msg}` };
      }
    }

    // /sync — report stale threads in this project
    const syncMatch = /^\s*\/sync(?:\s|$)/.exec(text);
    if (syncMatch && !/^\s*\/sync-reset/.test(text)) {
      const binding = await this.threadService.getUserBinding(this.requireProjectId(chatId), userId);
      const mergedThreadName = binding?.threadName ?? "__unknown__";
      const report = await this.detectStaleThreads(projectId, mergedThreadName);
      const lines: string[] = [];
      if (report.updated.length > 0) {
        lines.push(`✅ 自动更新 ${report.updated.length} 个线程:`);
        for (const u of report.updated) lines.push(`  • ${u.threadName}: ${u.oldSha.slice(0, 7)} → ${u.newSha.slice(0, 7)}`);
      }
      if (report.stale.length > 0) {
        lines.push(`⚠️ ${report.stale.length} 个线程需要手动同步 (/sync-reset):`);
        for (const s of report.stale) lines.push(`  • ${s.threadName} (base: ${s.baseSha.slice(0, 7)}, HEAD: ${s.workBranchHead.slice(0, 7)})`);
      }
      if (report.errors.length > 0) {
        lines.push(`❌ ${report.errors.length} 个线程处理失败:`);
        for (const e of report.errors) lines.push(`  • ${e.threadName}: ${e.error}`);
      }
      if (lines.length === 0) lines.push("✅ 所有线程已是最新状态。");
      return { mode: ResultMode.THREAD_SYNC_TEXT, id: "sync", text: lines.join("\n") };
    }

    // /sync-reset {threadName} — rebuild worktree from latest workBranch
    const syncResetMatch = /^\s*\/sync-reset\s+(\S+)/.exec(text);
    if (syncResetMatch) {
      const targetThreadName = syncResetMatch[1]!;
      try {
        // Delete old worktree and recreate
        await this.deleteThread(projectId, chatId, targetThreadName);
        return { mode: ResultMode.THREAD_SYNC_TEXT, id: "sync-reset", text: `✅ 线程 \`${targetThreadName}\` 已重置。请使用 /thread join 重新加入。` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { mode: ResultMode.THREAD_SYNC_TEXT, id: "sync-reset", text: `❌ 重置线程 \`${targetThreadName}\` 失败: ${msg}` };
      }
    }

    const planMatch = /^\s*\/plan(?:\s+|$)/.exec(text);
    const resolvedOptions = planMatch ? { mode: "plan" as const } : options;
    const normalizedText = planMatch ? text.slice(planMatch[0].length).trim() || "请先给出执行计划。" : text;
    const result = await this.handleUserTextForUser(projectId, chatId, userId, normalizedText, traceId, resolvedOptions);
    return { mode: ResultMode.TURN, id: result.turnId };
  }
}
