import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EventHandlers = Record<string, (data: Record<string, unknown>) => Promise<void>>;

const state = {
  handlers: {} as EventHandlers,
  wsStartCalls: [] as Array<Record<string, unknown>>,
  approvalHandleMock: vi.fn(async () => "applied" as const),
  handleIntentMock: vi.fn(async () => ({ mode: "noop", id: "test-id" })),
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

vi.mock("@larksuiteoapi/node-sdk", () => {
  const registerFn = vi.fn(function (this: unknown, handlers: EventHandlers) {
    Object.assign(state.handlers, handlers);
    return this;
  });
  const startFn = vi.fn(async (opts: Record<string, unknown>) => {
    state.wsStartCalls.push(opts);
  });
  return {
    WSClient: vi.fn(() => ({ start: startFn })),
    EventDispatcher: vi.fn(() => ({ register: registerFn })),
    LoggerLevel: { info: 2, debug: 1, warn: 3, error: 4 }
  };
});

vi.mock("../../../src/feishu/feishu-message-handler", () => ({
  handleFeishuMessage: vi.fn(async (deps: { orchestrator: { handleIntent: (...args: unknown[]) => Promise<unknown> } }, data: Record<string, unknown>) => {
    const message = data.message as Record<string, unknown> | undefined;
    const rawContent = String(message?.content ?? "{}");
    let text = "";
    try {
      text = String((JSON.parse(rawContent) as { text?: string }).text ?? "");
    } catch {
      text = rawContent;
    }
    await deps.orchestrator.handleIntent("default-project", String(message?.chat_id ?? ""), { intent: "TURN_START" }, text);
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
  ApprovalCallbackHandler: vi.fn(() => ({ handle: state.approvalHandleMock }))
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
    recoverSessions: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
    stopHealthCheck: vi.fn(),
    onProjectDeactivated: vi.fn()
  })),
  DefaultAgentApiPool: vi.fn(() => ({
    releaseAll: vi.fn().mockResolvedValue(undefined)
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
    close: vi.fn()
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
    loadConfig: state.loadConfigMock,
    ConfigError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = "ConfigError";
      }
    }
  };
});

describe("server-review: Stream mode regression tests", () => {
  beforeEach(async () => {
    state.handlers = {};
    state.wsStartCalls = [];
    state.approvalHandleMock.mockClear();
    state.handleIntentMock.mockClear();
    state.loadConfigMock.mockClear();

    const module = await import("../../../src/server");
    await module.createServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("[R2-1] card.action.trigger extracts real operator open_id, not hardcoded", async () => {
    const handler = state.handlers["card.action.trigger"];
    expect(handler).toBeDefined();

    await handler!({
      action: {
        value: {
          action: "approve",
          approvalId: "appr-user-1"
        }
      },
      operator: { open_id: "ou-maria" },
      context: { open_chat_id: "chat-1" }
    });

    expect(state.approvalHandleMock).toHaveBeenCalled();
    const firstCall = state.approvalHandleMock.mock.calls[0];
    const [decision] = (firstCall ?? []) as unknown as [{ approverId?: string }];
    expect(decision.approverId).toBe("ou-maria");
  });

  it("[R2-2] card.action.trigger falls back to 'unknown-approver' when operator missing", async () => {
    const handler = state.handlers["card.action.trigger"];
    expect(handler).toBeDefined();

    await handler!({
      action: {
        value: {
          action: "approve",
          approvalId: "appr-no-user"
        }
      },
      context: { open_chat_id: "chat-1" }
    });

    expect(state.approvalHandleMock).toHaveBeenCalled();
    const firstCall = state.approvalHandleMock.mock.calls[0];
    const [decision] = (firstCall ?? []) as unknown as [{ approverId?: string }];
    expect(decision.approverId).toBe("unknown-approver");
  });

  it("[ED-1] EventDispatcher registers im.message.receive_v1 handler", () => {
    expect(state.handlers["im.message.receive_v1"]).toBeTypeOf("function");
  });

  it("[ED-2] EventDispatcher registers card.action.trigger handler", () => {
    expect(state.handlers["card.action.trigger"]).toBeTypeOf("function");
  });

  it("[R15-1] server exposes createServer", async () => {
    const { createServer } = await import("../../../src/server");
    expect(createServer).toBeDefined();
  });

  it("[R19-1] loadConfig is called during createServer", () => {
    expect(state.loadConfigMock).toHaveBeenCalled();
    expect(state.loadConfigMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
