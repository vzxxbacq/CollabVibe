import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandlers = Record<string, (data: Record<string, unknown>) => Promise<void>>;

const state = {
  handlers: {} as EventHandlers,
  wsStartMock: vi.fn().mockResolvedValue(undefined),
  registerMock: vi.fn(),
  approvalHandleMock: vi.fn(async () => "applied" as const),
  handleIntentMock: vi.fn(async () => ({ mode: "noop", id: "test-id" })),
  releaseAllMock: vi.fn().mockResolvedValue(undefined),
  dbCloseMock: vi.fn(),
  stopHealthCheckMock: vi.fn(),
  recoverSessionsMock: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
  loadConfigMock: vi.fn(() => ({
    feishu: {
      appId: "cli_test",
      appSecret: "sec_test",
      signingSecret: undefined,
      apiBaseUrl: "https://open.feishu.cn/open-apis"
    },
    cwd: "/repo",
    sandbox: "workspace-write",
    approvalPolicy: "on-request",
    server: {
      port: 0,
      approvalTimeoutMs: 300000,
      sysAdminUserIds: []
    }
  }))
};

vi.mock("@larksuiteoapi/node-sdk", () => ({
  WSClient: vi.fn().mockImplementation(() => ({
    start: state.wsStartMock
  })),
  EventDispatcher: vi.fn().mockImplementation(() => ({
    register: state.registerMock.mockImplementation(function (this: unknown, handlers: EventHandlers) {
      state.handlers = { ...state.handlers, ...handlers };
      return this;
    })
  })),
  LoggerLevel: { info: 2, debug: 1, warn: 3, error: 4 }
}));

vi.mock("../../../src/feishu/feishu-message-handler", () => ({
  handleFeishuMessage: vi.fn(async (deps: { orchestrator: { handleIntent: (...args: unknown[]) => Promise<unknown> } }, data: Record<string, unknown>) => {
    const message = data.message as Record<string, unknown> | undefined;
    const sender = data.sender as Record<string, unknown> | undefined;
    const senderId = sender?.sender_id as Record<string, unknown> | undefined;
    const rawContent = String(message?.content ?? "{}");
    let text = "";
    try {
      text = String((JSON.parse(rawContent) as { text?: string }).text ?? "");
    } catch {
      text = rawContent;
    }
    await deps.orchestrator.handleIntent(
      "default-project",
      String(message?.chat_id ?? ""),
      { intent: "TURN_START", userId: String(senderId?.open_id ?? "") },
      text
    );
  })
}));

vi.mock("../../../src/feishu/feishu-card-handler", () => ({
  handleFeishuCardAction: vi.fn(async (deps: { approvalHandler: { handle: (arg: unknown) => Promise<unknown> } }, data: Record<string, unknown>) => {
    const action = data.action as Record<string, unknown> | undefined;
    const value = action?.value as Record<string, unknown> | undefined;
    const actionName = String(value?.action ?? "");
    if (actionName !== "approve" && actionName !== "reject") {
      return;
    }
    const operator = data.operator as Record<string, unknown> | undefined;
    await deps.approvalHandler.handle({
      approvalId: String(value?.approvalId ?? ""),
      approverId: String(operator?.open_id ?? "unknown-approver"),
      action: actionName
    });
  })
}));

vi.mock("../../../packages/channel-core/src/index", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  setLogSink: vi.fn(),
  createFileLogSink: vi.fn(() => ({})),
  multiSink: vi.fn(() => ({})),
  getLogSink: vi.fn(() => ({}))
}));

vi.mock("../../../packages/channel-feishu/src/index", () => ({
  FeishuAdapter: vi.fn().mockImplementation(() => ({
    sendInteractiveCard: vi.fn().mockResolvedValue(undefined)
  })),
  FeishuOutputAdapter: vi.fn().mockImplementation(() => ({
    onTurnComplete: undefined,
    sendMergeOperation: vi.fn().mockResolvedValue(undefined),
    buildProjectResumedCard: vi.fn(() => ({})),
    buildInitCard: vi.fn(() => ({})),
    buildAdminHelpCard: vi.fn(() => ({}))
  })),
  FetchHttpClient: vi.fn(),
  SqliteCardStateStore: vi.fn()
}));

vi.mock("../../../services/approval/src/index", () => ({
  ApprovalCallbackHandler: vi.fn(() => ({
    handle: state.approvalHandleMock
  }))
}));

vi.mock("../../../services/orchestrator/src/index", () => ({
  AcpApiFactory: vi.fn(),
  AgentApiFactoryRegistry: vi.fn(),
  AgentEventRouter: vi.fn(),
  CodexProtocolApiFactory: vi.fn(),
  AgentProcessManager: vi.fn(),
  ConversationOrchestrator: vi.fn(() => ({
    handleIntent: state.handleIntentMock,
    onResolverComplete: vi.fn(),
    registerApprovalRequest: vi.fn(),
    finishTurn: vi.fn(),
    onResolverTurnComplete: vi.fn(),
    onMergeResolverDone: vi.fn(),
    onMergeFileRetryDone: vi.fn(),
    setEventPipeline: vi.fn(),
    startHealthCheck: vi.fn(),
    runStartupValidation: vi.fn(),
    updateSnapshotSummary: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn(),
    recoverSessions: state.recoverSessionsMock,
    stopHealthCheck: state.stopHealthCheckMock,
    onProjectDeactivated: vi.fn()
  })),
  DefaultAgentApiPool: vi.fn(() => ({
    releaseAll: state.releaseAllMock
  })),
  DefaultRuntimeConfigProvider: vi.fn(),
  DefaultBackendSessionResolver: vi.fn(() => ({
    ensureSync: vi.fn().mockResolvedValue(undefined)
  })),
  BackendConfigService: vi.fn(() => ({
    ensureLocalConfigs: vi.fn()
  })),
  EventPipeline: vi.fn(),
  ThreadBindingService: vi.fn(),
  UserThreadBindingService: vi.fn(),
  createBackendRegistry: vi.fn(() => ({
    getDefault: () => ({ name: "codex", models: ["gpt-5-codex"], serverCmd: "codex app-server" })
  })),
  PluginService: vi.fn()
}));

vi.mock("../../../packages/agent-core/src/backend-identity", () => ({
  createBackendIdentity: vi.fn((backendId: string, model: string) => ({ backendId, model, transport: "stdio" })),
  isBackendId: vi.fn(() => true)
}));

vi.mock("../../../services/persistence/src/index", () => ({
  SqliteAdminStateStore: vi.fn(() => ({
    read: vi.fn(() => ({ projects: [] })),
    write: vi.fn()
  })),
  SqliteApprovalStore: vi.fn(),
  SqliteAuditStore: vi.fn(),
  SqlitePluginCatalogStore: vi.fn(),
  SqliteSnapshotRepository: vi.fn(),
  SqliteUserThreadBindingRepository: vi.fn(),
  SqliteTurnRepository: vi.fn(),
  SqliteTurnDetailRepository: vi.fn(),
  SqliteThreadTurnStateRepository: vi.fn(),
  SqliteThreadBindingRepository: vi.fn(),
  SqliteUserRepository: vi.fn(() => ({
    seedEnvAdmins: vi.fn(),
    isAdmin: vi.fn(() => false)
  })),
  SqliteThreadRegistry: vi.fn(),
  createDatabase: vi.fn(async () => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      all: vi.fn(() => []),
      get: vi.fn(() => undefined)
    })),
    close: state.dbCloseMock
  }))
}));

vi.mock("../../../services/iam/src/role-resolver", () => ({
  RoleResolver: vi.fn(() => ({
    autoRegister: vi.fn()
  }))
}));

vi.mock("../../../services/audit/src/index", () => ({
  AuditService: vi.fn()
}));

vi.mock("../../../src/services/project-setup-service", () => ({
  ProjectSetupService: vi.fn()
}));

vi.mock("../../../packages/git-utils/src/index", () => ({
  getRemoteUrl: vi.fn().mockResolvedValue(null)
}));

vi.mock("../../../src/config", async () => {
  const actual = await vi.importActual<typeof import("../../../src/config")>("../../../src/config");
  return {
    ...actual,
    loadConfig: state.loadConfigMock
  };
});

describe("server (Stream mode)", () => {
  let shutdown: (() => Promise<void>) | null = null;

  beforeEach(async () => {
    state.handlers = {};
    state.wsStartMock.mockClear();
    state.registerMock.mockClear();
    state.approvalHandleMock.mockClear();
    state.handleIntentMock.mockClear();
    state.releaseAllMock.mockClear();
    state.dbCloseMock.mockClear();
    state.stopHealthCheckMock.mockClear();
    state.recoverSessionsMock.mockClear();
    state.loadConfigMock.mockClear();

    const module = await import("../../../src/server");
    const runtime = await module.createServer();
    shutdown = runtime.shutdown;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("[S1] WSClient.start() is called with eventDispatcher", () => {
    expect(state.wsStartMock).toHaveBeenCalledTimes(1);
    const startArg = state.wsStartMock.mock.calls[0]?.[0] as { eventDispatcher?: unknown } | undefined;
    expect(startArg?.eventDispatcher).toBeDefined();
  });

  it("[S2] EventDispatcher.register() is called with im.message.receive_v1 and card.action.trigger", () => {
    expect(state.registerMock).toHaveBeenCalled();
    expect(state.handlers["im.message.receive_v1"]).toBeTypeOf("function");
    expect(state.handlers["card.action.trigger"]).toBeTypeOf("function");
  });

  it("[S3] im.message.receive_v1 handler calls orchestrator.handleIntent for text messages", async () => {
    const handler = state.handlers["im.message.receive_v1"];
    expect(handler).toBeDefined();

    await handler!({
      message: {
        chat_id: "chat-test-1",
        message_type: "text",
        content: JSON.stringify({ text: "hello world" })
      },
      sender: {
        sender_id: { open_id: "ou-user-1" }
      }
    });

    expect(state.handleIntentMock).toHaveBeenCalled();
    const firstCall = state.handleIntentMock.mock.calls[0];
    const [projectId, chatId, intent, text] = (firstCall ?? []) as unknown as [
      string,
      string,
      { intent: string },
      string
    ];
    expect(projectId).toBe("default-project");
    expect(chatId).toBe("chat-test-1");
    expect(intent.intent).toBe("TURN_START");
    expect(text).toBe("hello world");
  });

  it("[S4] card.action.trigger handler calls approvalHandler.handle", async () => {
    const handler = state.handlers["card.action.trigger"];
    expect(handler).toBeDefined();

    await handler!({
      action: {
        value: {
          action: "approve",
          approvalId: "appr-stream-1"
        }
      },
      operator: { open_id: "ou-approver-1" },
      context: { open_chat_id: "chat-1" }
    });

    expect(state.approvalHandleMock).toHaveBeenCalled();
    const firstCall = state.approvalHandleMock.mock.calls[0];
    const [decision] = (firstCall ?? []) as unknown as [{
      approvalId: string;
      approverId: string;
      action: string;
    }];
    expect(decision.approvalId).toBe("appr-stream-1");
    expect(decision.approverId).toBe("ou-approver-1");
    expect(decision.action).toBe("approve");
  });

  it("[S5] shutdown releases resources", async () => {
    await expect(shutdown?.()).resolves.toBeUndefined();
    expect(state.stopHealthCheckMock).toHaveBeenCalledTimes(1);
    expect(state.releaseAllMock).toHaveBeenCalledTimes(1);
    expect(state.dbCloseMock).toHaveBeenCalledTimes(1);
  });

  it("[S6] card.action.trigger ignores unknown actions", async () => {
    const handler = state.handlers["card.action.trigger"];
    expect(handler).toBeDefined();

    await handler!({
      action: {
        value: {
          action: "unknown_action",
          approvalId: "appr-unknown"
        }
      },
      operator: { open_id: "ou-1" },
      context: { open_chat_id: "chat-1" }
    });

    expect(state.approvalHandleMock).not.toHaveBeenCalled();
  });
});
