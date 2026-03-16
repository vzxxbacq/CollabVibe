import { describe, expect, it, vi } from "vitest";

import { handleInboundMessage } from "../../../src/handlers/inbound-message";
import { ConversationOrchestrator, UserThreadBindingService } from "../../../services/orchestrator/src/index";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../../../services/orchestrator/tests/helpers/test-runtime";

describe("inbound-no-thread", () => {
  it("does not start backend or bind pipeline when no thread is selected", async () => {
    const sendMessage = vi.fn(async () => "msg-1");
    const api = {
      backendType: "codex" as const,
      onNotification: vi.fn(),
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const bind = vi.fn();
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(api),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: {
        reserve: () => ({ reservationId: 'resv-1', projectId: 'proj-1', threadName: 't1' }),
        activate: () => { },
        release: () => { },
        get: () => null,
        register: () => { },
        list: () => [],
        remove: () => { }
      }
    });

    await handleInboundMessage({
      config: {
        feishu: { appId: "", appSecret: "", signingSecret: "", apiBaseUrl: "" },
        cwd: "/repo",
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        server: { port: 0, approvalTimeoutMs: 300000, sysAdminUserIds: [] }
      },
      feishuAdapter: {
        sendMessage,
        sendInteractiveCard: vi.fn(),
        getUserDisplayName: vi.fn(),
        pinMessage: vi.fn()
      },
      feishuOutputAdapter: {
        buildHelpCard: vi.fn(),
        buildInitCard: vi.fn(),
        buildInitSuccessCard: vi.fn(),
        buildThreadCreatedCard: vi.fn(),
        buildMergeResultCard: vi.fn(),
        buildMergePreviewCard: vi.fn(),
        buildThreadListCard: vi.fn(),
        buildSnapshotHistoryCard: vi.fn(),
        buildModelListCard: vi.fn(),
        sendThreadNewForm: vi.fn(),
        sendThreadOperation: vi.fn(),
        sendSnapshotOperation: vi.fn(),
        sendConfigOperation: vi.fn(),
        sendSkillOperation: vi.fn(),
        sendMergeOperation: vi.fn(),
        sendRawCard: vi.fn(),
        updateCardAction: vi.fn(),
        setCardThreadName: vi.fn(),
        setCardBackendInfo: vi.fn()
      },
      orchestrator,
      runtimeConfigProvider: {
        getCwdOverride: vi.fn(),
        setCwdOverride: vi.fn(),
        clearCwdOverride: vi.fn(),
        setBackendOverride: vi.fn(),
        clearBackendOverride: vi.fn()
      },
      apiPool: {
        getOrCreate: vi.fn(async () => api),
        release: vi.fn(async () => undefined),
        getLifecycleState: vi.fn(() => "NOT_STARTED")
      },
      backendSessionResolver: {
        resolve: vi.fn(async () => ({ backendName: "codex", model: "gpt-5-codex", availableModels: ["gpt-5-codex"], transport: "codex" })),
        listAvailableBackends: vi.fn(async () => []),
        getDefaultBackendName: vi.fn(() => "codex"),
        getDefaultModel: vi.fn(() => "gpt-5-codex"),
        resolveBackendByName: vi.fn(async () => undefined)
      },
      pluginService: {
        getInstallablePlugins: vi.fn(async () => []),
        install: vi.fn(),
        remove: vi.fn()
      },
      userThreadBindingService: new UserThreadBindingService(),
      approvalHandler: { handle: vi.fn() },
      projectSetupService: { setupFromInitCard: vi.fn() },
      adminStateStore: { read: vi.fn(() => ({ projects: [], members: {}, wizard: {} })), write: vi.fn() },
      findProjectByChatId: vi.fn(() => null),
      userRepository: {
        isAdmin: vi.fn(() => false),
        listAdmins: vi.fn(() => []),
        setAdmin: vi.fn(),
        removeAdmin: vi.fn(() => ({ ok: true })),
        ensureUser: vi.fn(),
        listAll: vi.fn(() => ({ users: [], total: 0 })),
      },
      recentMessageIds: new Set(),
      messageDedupTtlMs: 1000,
      eventPipeline: { bind },
      threadRegistry: {
        reserve: () => ({ reservationId: 'resv-1', projectId: 'proj-1', threadName: 't1' }),
        activate: () => { },
        release: () => { },
        get: () => undefined,
        register: () => { },
        list: () => [],
        remove: () => { }
      }
    } as never, {
      message: {
        chat_id: "chat-1",
        chat_type: "group",
        content: JSON.stringify({ text: "@_user_1 hello" }),
        message_id: "m1",
        mentions: [{ key: "@_user_1", id: { open_id: "bot-id" }, name: "bot" }]
      },
      sender: { sender_id: { open_id: "u1" } }
    });

    expect(api.threadStart).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({ chatId: "chat-1", text: "💡 请先 @bot 打开面板创建或加入线程" });
  });
});
