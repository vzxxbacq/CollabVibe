/**
 * @module src/server
 * @layer Wiring (composition root)
 *
 * Application entry point — constructs all services and wires them together.
 *
 * ## Responsibilities
 * - Initialize infrastructure: database, logging, Feishu SDK
 * - Construct all service instances (orchestrator, skill, backend, approval, etc.)
 * - Build `FeishuHandlerDeps` from constructed services
 * - Create `FeishuWsApp` and bind callback handlers:
 *   - `im.message.receive_v1` → `handleFeishuMessage(deps, data)`
 *   - `card.action.trigger` → `handleFeishuCardAction(deps, data)`
 *   - `im.chat.member.bot.added_v1` → send init card
 *   - `application.bot.menu_v6` → send admin help card (single-chat only)
 * - Wire orchestrator hooks (onTurnComplete, onResolverComplete)
 * - Export `createServer()` for testing and `main()` for production
 *
 * ## Architecture
 * ```
 * server.ts (wiring)
 *   ├── constructs: services/orchestrator, services/persistence, packages/channel-feishu
 *   ├── builds: FeishuHandlerDeps
 *   └── delegates to: src/feishu/feishu-message-handler, src/feishu/feishu-card-handler
 * ```
 *
 * ## Adding a New Platform (e.g. Slack)
 * 1. Create `src/slack/types.ts` with `SlackHandlerDeps extends CoreDeps`
 * 2. Create `src/slack/slack-message-handler.ts` etc.
 * 3. In this file, build `SlackHandlerDeps` and pass to Slack handler callbacks
 */
import * as Lark from "@larksuiteoapi/node-sdk";

import {
  createLogger,
  setLogSink,
  createFileLogSink,
  multiSink,
  getLogSink,
  createFilteredSink,
  LOG_LEVEL_VALUES,
  setModuleLogLevels
} from "../packages/channel-core/src/index";

import { FeishuAdapter, FeishuOutputAdapter, FetchHttpClient, SqliteCardStateStore } from "../packages/channel-feishu/src/index";
import { ApprovalCallbackHandler } from "../services/approval/src/index";
import { AuditService } from "../services/audit/src/index";
import {
  AcpApiFactory,
  AgentApiFactoryRegistry,
  AgentEventRouter,
  CodexProtocolApiFactory,
  AgentProcessManager,
  ConversationOrchestrator,
  DefaultAgentApiPool,
  DefaultRuntimeConfigProvider,
  DefaultBackendSessionResolver,
  BackendConfigService,
  EventPipeline,
  UserThreadBindingService,
  createBackendRegistry,
  PluginService,
  type RuntimeDefaults
} from "../services/orchestrator/src/index";
import { createBackendIdentity, isBackendId } from "../packages/agent-core/src/backend-identity";
import { RoleResolver } from "../services/iam/src/role-resolver";
import {
  SqliteAdminStateStore,
  SqliteApprovalStore,
  SqliteAuditStore,
  SqlitePluginCatalogStore,
  SqliteSnapshotRepository,
  SqliteThreadTurnStateRepository,
  SqliteTurnDetailRepository,
  SqliteTurnRepository,
  SqliteUserRepository,
  SqliteUserThreadBindingRepository,
  SqliteThreadRegistry,
  createDatabase
} from "../services/persistence/src/index";
import { ConfigError, loadConfig } from "./config";
import { FeishuWsApp } from "./feishu/feishu-ws-app";
import { handleFeishuCardAction } from "./feishu/feishu-card-handler";
import { handleFeishuMessage } from "./feishu/feishu-message-handler";
import type { FeishuHandlerDeps } from "./feishu/types";
import { ProjectSetupService } from "./services/project-setup-service";

export interface RuntimeServices {
  wsClient: Lark.WSClient;
  shutdown: () => Promise<void>;
}

export async function createServer(config = loadConfig()): Promise<RuntimeServices> {
  // 初始化日志持久化
  if (!process.env.VITEST) {
    const moduleLevels = String(process.env.LOG_MODULE_LEVELS ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .reduce<Record<string, "trace" | "debug" | "info" | "warn" | "error" | "fatal">>((acc, part) => {
        const [name, level] = part.split("=", 2).map((value) => value?.trim() ?? "");
        if (name && level && ["trace", "debug", "info", "warn", "error", "fatal"].includes(level)) {
          acc[name] = level as "trace" | "debug" | "info" | "warn" | "error" | "fatal";
        }
        return acc;
      }, {});
    if (Object.keys(moduleLevels).length > 0) {
      setModuleLogLevels(moduleLevels);
    }

    const consoleSink = getLogSink();
    const noisyDebugLoggers = new Set(
      String(process.env.LOG_DEBUG_MODULES ?? "stdio-rpc,acp-rpc")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    );
    const isNoisyDebugEntry = (entry: { name: string; level: number }) =>
      noisyDebugLoggers.has(entry.name) && entry.level <= LOG_LEVEL_VALUES.debug;
    const isBackendRpcEntry = (entry: { name: string }) => entry.name === "backend-rpc";

    const mainFileSink = createFileLogSink({ dir: process.env.LOG_DIR ?? "data/logs" });
    const stdioFileSink = createFileLogSink({
      dir: process.env.LOG_DIR ?? "data/logs",
      baseName: process.env.LOG_STDIO_BASE_NAME ?? "agent-stdio"
    });
    const backendRpcFileSink = createFileLogSink({
      dir: process.env.LOG_DIR ?? "data/logs",
      baseName: process.env.LOG_BACKEND_RPC_BASE_NAME ?? "backend-rpc"
    });

    setLogSink(multiSink(
      createFilteredSink(consoleSink, (entry) => !isNoisyDebugEntry(entry) && !isBackendRpcEntry(entry)),
      createFilteredSink(mainFileSink, (entry) => !isNoisyDebugEntry(entry)),
      createFilteredSink(stdioFileSink, isNoisyDebugEntry),
      createFilteredSink(backendRpcFileSink, isBackendRpcEntry)
    ));
  }
  const log = createLogger("server");

  const db = await createDatabase(process.env.VITEST ? ":memory:" : "./data/codex-im.db");
  const adminStateStore = new SqliteAdminStateStore(db);
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

  const httpClient = new FetchHttpClient(config.feishu);
  const feishuAdapter = new FeishuAdapter({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    signingSecret: config.feishu.signingSecret ?? "",
    apiBaseUrl: config.feishu.apiBaseUrl,
    httpClient
  });
  const feishuOutputAdapter = new FeishuOutputAdapter(feishuAdapter, {
    cardStateStore: new SqliteCardStateStore(db),
    locale: config.locale,
  });

  const backendRegistry = createBackendRegistry();
  const backendConfigService = new BackendConfigService("data/config");
  backendConfigService.ensureLocalConfigs();
  const pluginCatalogStore = new SqlitePluginCatalogStore(db);
  const userThreadBindingService = new UserThreadBindingService(new SqliteUserThreadBindingRepository(db));
  const threadRegistry = new SqliteThreadRegistry(db);
  const backendSessionResolver = new DefaultBackendSessionResolver(
    backendRegistry, backendConfigService, (chatId, threadName) => {
      const projectId = projectResolver.findProjectByChatId(chatId)?.id;
      return projectId ? threadRegistry.get(projectId, threadName) : null;
    }
  );

  // Sync backend configs from config files into registry
  await backendSessionResolver.ensureSync();

  const currentBackend = backendRegistry.getDefault();
  const pluginService = new PluginService(
    config.cwd,
    pluginCatalogStore,
    undefined,
    adminStateStore,
  );

  const processManager = new AgentProcessManager();
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
    serverPort: config.server.port
  };
  const runtimeConfigProvider = new DefaultRuntimeConfigProvider(
    projectResolver, runtimeDefaults
  );
  const apiFactory = new AgentApiFactoryRegistry({
    codex: new CodexProtocolApiFactory(processManager),
    acp: new AcpApiFactory()
  });
  const apiPool = new DefaultAgentApiPool({ apiFactory });

  const snapshotRepo = new SqliteSnapshotRepository(db);
  const turnRepository = new SqliteTurnRepository(db);
  const turnDetailRepository = new SqliteTurnDetailRepository(db);
  const threadTurnStateRepository = new SqliteThreadTurnStateRepository(db);
  const orchestrator = new ConversationOrchestrator({
    agentApiPool: apiPool,
    runtimeConfigProvider,
    userThreadBindingService,
    snapshotRepo,
    turnRepository,
    turnDetailRepository,
    threadTurnStateRepository,
    approvalTimeoutMs: config.server.approvalTimeoutMs,
    pluginService,
    cwd: config.cwd,
    threadRegistry,
    backendRegistry,
    backendSessionResolver,
    backendConfigService,
    projectResolver,
  });

  feishuOutputAdapter.onTurnComplete = (chatId, summary) => {
    if (summary.threadId && summary.turnId) {
      orchestrator.updateTurnSummary(chatId, summary.turnId, {
        lastAgentMessage: summary.lastAgentMessage,
        tokenUsage: summary.tokenUsage,
        filesChanged: summary.filesChanged
      }).catch((error) => log.warn({
        chatId,
        threadId: summary.threadId,
        turnId: summary.turnId,
        err: error instanceof Error ? error.message : String(error)
      }, "updateTurnSummary failed"));

      const agentSummary = summary.lastAgentMessage ? summary.lastAgentMessage.slice(0, 200) : undefined;
      if (agentSummary) {
        orchestrator.updateSnapshotSummary(
          chatId,
          summary.turnId,
          agentSummary,
          summary.filesChanged
        ).catch((error) => log.warn({
          chatId,
          threadId: summary.threadId,
          turnId: summary.turnId,
          err: error instanceof Error ? error.message : String(error)
        }, "updateSnapshotSummary failed"));
      }
    }
  };

  // Wire resolver completion → send merge preview or failure card
  orchestrator.onResolverComplete((info) => {
    if (info.success) {
      feishuOutputAdapter.sendMergeOperation(info.chatId, {
        kind: "thread_merge",
        action: "preview",
        branchName: info.resolverName,
        message: info.message,
        diffStats: info.diffStats
      }).catch((error) => log.warn({
        chatId: info.chatId,
        branchName: info.resolverName,
        traceId: info.traceId,
        threadId: info.threadId,
        turnId: info.turnId,
        err: error instanceof Error ? error.message : String(error)
      }, "send merge preview failed"));
    } else {
      feishuOutputAdapter.sendMergeOperation(info.chatId, {
        kind: "thread_merge",
        action: "conflict",
        branchName: info.branchName,
        message: info.message,
        conflicts: info.remaining
      }).catch((error) => log.warn({
        chatId: info.chatId,
        branchName: info.branchName,
        traceId: info.traceId,
        threadId: info.threadId,
        turnId: info.turnId,
        err: error instanceof Error ? error.message : String(error)
      }, "send merge conflict failed"));
    }
  });

  // Merge review/summary and session timeout now flow through Path B convergence
  // via ctx.routeMessage → AgentEventRouter → FeishuOutputAdapter.
  // No bypass wiring needed here.

  const approvalHandler = new ApprovalCallbackHandler(
    new SqliteApprovalStore(db),
    { applyDecision: orchestrator.resume.bind(orchestrator) }
  );
  const eventPipeline = new EventPipeline(new AgentEventRouter(feishuOutputAdapter, {
    persistMessage: async (chatId, message) => {
      await orchestrator.appendTurnEvent(chatId, message);
    }
  }), {
    registerApprovalRequest: orchestrator.registerApprovalRequest.bind(orchestrator),
    finishTurn: orchestrator.finishTurn.bind(orchestrator),
    onResolverTurnComplete: orchestrator.onResolverTurnComplete.bind(orchestrator),
    onMergeConflictResolved: orchestrator.onMergeResolverDone.bind(orchestrator),
    onMergeFileRetryDone: orchestrator.onMergeFileRetryDone.bind(orchestrator),
  });
  orchestrator.setEventPipeline(eventPipeline);
  orchestrator.startHealthCheck();
  orchestrator.runStartupValidation();
  const projectSetupService = new ProjectSetupService(adminStateStore, config);
  const userRepo = new SqliteUserRepository(db);
  userRepo.seedEnvAdmins(config.server.sysAdminUserIds);
  const roleResolver = new RoleResolver(userRepo, adminStateStore);
  const auditService = new AuditService(new SqliteAuditStore(db));

  const deps: FeishuHandlerDeps = {
    config,
    feishuAdapter,
    feishuOutputAdapter,
    orchestrator,
    pluginService,
    approvalHandler,
    projectSetupService,
    adminStateStore,
    findProjectByChatId,
    userRepository: userRepo,
    recentMessageIds: new Set<string>(),
    messageDedupTtlMs: 60_000,
    roleResolver,
    auditService,
  };

  const wsApp = new FeishuWsApp({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    loggerLevel: Lark.LoggerLevel.info,
    onInboundMessage: (data) => handleFeishuMessage(deps, data),
    onCardAction: (data) => handleFeishuCardAction(deps, data),
    onBotAdded: async (data) => {
      try {
        const chatId = String((data.chat_id as string) ?? (data as Record<string, unknown>).chat_id ?? "");
        const resolvedChatId = chatId || String(((data as Record<string, unknown>).chat as Record<string, unknown> | undefined)?.chat_id ?? "");
        if (!resolvedChatId) {
          return;
        }
        // Smart re-entry: check if chat already has a bound project
        const existing = findProjectByChatId(resolvedChatId);
        if (existing) {
          // Re-enable if disabled
          if (existing.status === "disabled") {
            const state = adminStateStore.read();
            const proj = state.projects.find(p => p.id === existing.id);
            if (proj) { proj.status = "active"; proj.updatedAt = new Date().toISOString(); adminStateStore.write(state); }
          }
          await feishuAdapter.sendInteractiveCard(resolvedChatId, feishuOutputAdapter.buildProjectResumedCard(existing));
          log.info({ chatId: resolvedChatId, projectId: existing.id }, "bot.added: project resumed");
        } else {
          // Check for unbound projects to offer dual-mode Init Card
          const state = adminStateStore.read();
          const unbound = state.projects.filter(p => !p.chatId).map(p => ({
            id: p.id, name: p.name, cwd: p.cwd, gitUrl: p.gitUrl
          }));
          await feishuAdapter.sendInteractiveCard(resolvedChatId, feishuOutputAdapter.buildInitCard(unbound.length > 0 ? unbound : undefined));
          log.info({ chatId: resolvedChatId, unboundCount: unbound.length }, "bot.added: sent init card");
        }
      } catch (error) {
        log.error({ err: error instanceof Error ? error.message : error }, "bot.added error");
      }
    },
    onBotRemoved: async (data) => {
      try {
        const chatId = String((data.chat_id as string) ?? (data as Record<string, unknown>).chat_id ?? "");
        const resolvedChatId = chatId || String(((data as Record<string, unknown>).chat as Record<string, unknown> | undefined)?.chat_id ?? "");
        if (!resolvedChatId) return;
        const unbound = await projectSetupService.disableAndUnbindProjectByChatId(resolvedChatId);
        if (unbound) {
          await orchestrator.onProjectDeactivated(resolvedChatId);
          log.info({ chatId: resolvedChatId, projectId: unbound.projectId, newStatus: unbound.newStatus }, "bot.removed: project disabled + unbound + sessions released");
        }
      } catch (error) {
        log.error({ err: error instanceof Error ? error.message : error }, "bot.removed error");
      }
    },
    onMemberJoined: async (data) => {
      try {
        const event = data as Record<string, unknown>;
        const chatId = String((event.chat_id as string) ?? ((event.chat as Record<string, unknown> | undefined)?.chat_id) ?? "");
        const users = Array.isArray(event.users) ? event.users as Array<Record<string, unknown>> : [];
        if (!chatId || users.length === 0) return;

        // Find project bound to this chatId
        const state = adminStateStore.read();
        const project = state.projects.find((p) => p.chatId === chatId);
        if (!project) return;

        for (const u of users) {
          const userId = String((u.user_id as Record<string, unknown> | undefined)?.open_id ?? u.open_id ?? "");
          if (userId) {
            roleResolver.autoRegister(userId, project.id);
            log.info({ chatId, userId, projectId: project.id }, "member.joined: auto-registered");
          }
        }
      } catch (error) {
        log.error({ err: error instanceof Error ? error.message : error }, "member.joined error");
      }
    },
    onBotMenuEvent: async (data) => {
      try {
        const event = data as Record<string, unknown>;
        const eventKey = String(event.event_key ?? "");
        const operator = event.operator as Record<string, unknown> | undefined;
        const operatorId = operator?.operator_id as Record<string, unknown> | undefined;
        const openId = String(operatorId?.open_id ?? "");
        if (!openId) return;

        // Only admin can trigger admin panel
        const isAdmin = userRepo.isAdmin(openId);
        if (!isAdmin) {
          log.info({ openId, eventKey }, "bot.menu: ignored non-admin");
          return;
        }

        if (eventKey === "admin_menu_event") {
          const card = feishuOutputAdapter.buildAdminHelpCard();
          await feishuAdapter.sendInteractiveCard(openId, card, "open_id");
          log.info({ openId, eventKey }, "bot.menu: sent admin help card");
        } else {
          log.info({ openId, eventKey }, "bot.menu: unknown event_key");
        }
      } catch (error) {
        log.error({ err: error instanceof Error ? error.message : error }, "bot.menu error");
      }
    }
  });

  // ── Startup: backfill missing gitUrl/defaultBranch/timestamps for existing projects ──
  try {
    const { detectDefaultBranch, getRemoteUrl } = await import("../packages/git-utils/src/index");
    const state = adminStateStore.read();
    let dirty = false;
    for (const p of state.projects) {
      if (!p.gitUrl && p.cwd) {
        try {
          const url = await getRemoteUrl(p.cwd);
          if (url) { p.gitUrl = url; dirty = true; }
        } catch { /* no remote — skip */ }
      }
      if (!p.defaultBranch && p.cwd) {
        try {
          p.defaultBranch = await detectDefaultBranch(p.cwd);
          dirty = true;
        } catch { /* branch detection failed — keep explicit absence */ }
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

  // ── Startup: eager session recovery for active projects ──
  {
    const state = adminStateStore.read();
    const activeProjectIds = state.projects
      .filter(p => p.status === "active" && p.chatId)
      .map(p => p.id);
    if (activeProjectIds.length > 0) {
      const { recovered, failed, failures } = await orchestrator.recoverSessions(activeProjectIds);
      if (failed > 0) {
        log.error({ failures }, "startup: session recovery failures");
        throw new Error(`startup session recovery failed for ${failed} thread(s): ${failures.map(item => `${item.projectId}/${item.threadName}[${item.category}]: ${item.reason}`).join("; ")}`);
      }
      log.info({ recovered, failed }, "startup: session recovery done");
    }
  }

  const wsClient = await wsApp.start();

  const shutdown = async (): Promise<void> => {
    orchestrator.stopHealthCheck();
    if (typeof apiPool.releaseAll === "function") {
      await apiPool.releaseAll();
    }
    db.close();
  };

  return { wsClient, shutdown };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const { shutdown } = await createServer(config);

  const log = createLogger("server");
  log.info("Codex IM server started (Stream mode — WebSocket)");

  const graceful = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", graceful);
  process.on("SIGINT", graceful);
}

/* istanbul ignore next -- entry point guard */
if (!process.env.VITEST) {
  const bootLog = createLogger("boot");
  main().catch((error) => {
    if (error instanceof ConfigError) {
      bootLog.fatal({ err: error.message }, "config error");
      process.exit(1);
    }
    bootLog.fatal({ err: error }, "unhandled startup error");
    process.exit(1);
  });
}
