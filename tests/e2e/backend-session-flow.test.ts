import { describe, expect, it, vi } from "vitest";

import { createBackendIdentity } from "../../packages/agent-core/src/backend-identity";
import { ApprovalCallbackHandler } from "../../services/approval/src/index";
import {
  ApprovalWaitManager,
  handleInboundWebhook,
  ConversationOrchestrator,
  UserThreadBindingService
} from "../../services/orchestrator/src/index";

function createThreadRegistry() {
  const records = new Map<string, {
    projectId?: string;
    chatId?: string;
    threadName: string;
    threadId: string;
    backend: ReturnType<typeof createBackendIdentity>;
  }>();
  const reservations = new Map<string, {
    projectId: string;
    chatId?: string;
    threadName: string;
    backend: ReturnType<typeof createBackendIdentity>;
  }>();
  const keyOf = (projectId: string, threadName: string) => `${projectId}:${threadName}`;
  return {
    reserve(record: {
      projectId?: string;
      chatId?: string;
      threadName: string;
      backend: ReturnType<typeof createBackendIdentity>;
    }) {
      const projectId = record.projectId ?? record.chatId ?? "";
      if (records.has(keyOf(projectId, record.threadName))) {
        throw new Error('THREAD_ALREADY_EXISTS:active');
      }
      for (const reservation of reservations.values()) {
        if (reservation.projectId === projectId && reservation.threadName === record.threadName) {
          throw new Error('THREAD_ALREADY_EXISTS:creating');
        }
      }
      const reservationId = `resv:${projectId}:${record.threadName}`;
      reservations.set(reservationId, { projectId, chatId: record.chatId, threadName: record.threadName, backend: record.backend });
      return { reservationId, projectId, chatId: record.chatId, threadName: record.threadName };
    },
    activate(reservationId: string, record: {
      projectId?: string;
      chatId?: string;
      threadName: string;
      threadId: string;
      backend: ReturnType<typeof createBackendIdentity>;
    }) {
      reservations.delete(reservationId);
      const projectId = record.projectId ?? record.chatId ?? "";
      records.set(keyOf(projectId, record.threadName), record);
    },
    release(reservationId: string) {
      reservations.delete(reservationId);
    },
    register(record: {
      projectId?: string;
      chatId?: string;
      threadName: string;
      threadId: string;
      backend: ReturnType<typeof createBackendIdentity>;
    }) {
      const projectId = record.projectId ?? record.chatId ?? "";
      records.set(keyOf(projectId, record.threadName), record);
    },
    get(projectId: string, threadName: string) {
      return records.get(keyOf(projectId, threadName)) ?? null;
    },
    list(projectId: string) {
      return [...records.values()].filter((record) => (record.projectId ?? record.chatId) === projectId);
    },
    listAll() {
      return [...records.values()];
    },
    remove(projectId: string, threadName: string) {
      records.delete(keyOf(projectId, threadName));
    }
  };
}

function createAgentApiPool(api: Record<string, unknown>) {
  return {
    get: vi.fn(() => api),
    createWithConfig: vi.fn(async () => api),
    releaseThread: vi.fn(async () => undefined),
    releaseByPrefix: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => ({ alive: true, threadCount: 1 }))
  };
}

describe("backend session e2e", () => {
  it("times out approval when callback is missing", () => {
    vi.useFakeTimers();
    const manager = new ApprovalWaitManager({ timeoutMs: 500 });
    const timedOut: string[] = [];
    manager.waitFor("appr-1", (approvalId: string) => timedOut.push(approvalId));
    vi.advanceTimersByTime(500);
    expect(timedOut).toEqual(["appr-1"]);
    vi.useRealTimers();
  });

  it("does not misroute card_action and unknown intents to codex turn/start", async () => {
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-card",
        chatId: "chat-1",
        userId: "u1",
        timestamp: 1,
        raw: {},
        type: "card_action" as const,
        action: "approve",
        value: { id: "appr-1" }
      })),
      sendMessage: vi.fn(async () => "msg-1")
    };
    const orchestrator = {
      handleIntent: vi.fn(async () => ({ mode: "turn" as const, id: "turn-1" }))
    };

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "maintainer",
      headers: {},
      body: "{}",
      payload: {}
    });

    expect(result).toEqual({
      ok: true,
      result: {
        mode: "noop",
        id: "UNKNOWN"
      }
    });
    expect(orchestrator.handleIntent).not.toHaveBeenCalled();
  });

  it("runs approval callback chain: webhook -> approval wait -> callback -> codex continue", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } })),
      respondApproval: vi.fn(async () => undefined)
    };
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      chatId: "chat-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-1"
    });
    const threadRegistry = createThreadRegistry();
    threadRegistry.register({
      chatId: "chat-1",
      threadName: "fix-retry",
      threadId: "thr-1",
      backend: createBackendIdentity("codex", "gpt-5-codex")
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: createAgentApiPool(codexApi) as never,
      threadRegistry: threadRegistry as never,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          model: "gpt-5-codex",
          backend: createBackendIdentity("codex", "gpt-5-codex")
        }))
      },
      userThreadBindingService
    });

    await orchestrator.handleIntent(
      "proj-1",
      "chat-1",
      { intent: "TURN_START", args: {} },
      "run command",
      "trace-1",
      "u1"
    );
    orchestrator.registerApprovalRequest({
      chatId: "chat-1",
      userId: "u1",
      approvalId: "appr-1",
      threadId: "thr-1",
      threadName: "fix-retry",
      turnId: "turn-1",
      callId: "call-1",
      approvalType: "command_exec"
    });

    const result = await new ApprovalCallbackHandler(
      { save: vi.fn(async () => undefined) },
      {
        applyDecision: async (approvalId: string, action: "approve" | "deny" | "approve_always") => {
          const res = await orchestrator.handleApprovalDecision(
            approvalId,
            action === "approve" ? "accept" : action === "deny" ? "decline" : "approve_always"
          );
          return res === "duplicate" ? "duplicate" : "resolved";
        }
      }
    ).handle(
      {
        approvalId: "appr-1",
        approverId: "approver-1",
        action: "approve"
      },
      true
    );

    expect(result).toBe("applied");
    expect(codexApi.respondApproval).toHaveBeenCalledWith({
      action: "approve",
      approvalId: "appr-1",
      threadId: "thr-1",
      turnId: "turn-1",
      callId: "call-1",
      approvalType: "command_exec"
    });
  });

  it("runs text webhook -> orchestrator turn -> approval callback -> codex continue", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } })),
      respondApproval: vi.fn(async () => undefined)
    };
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      chatId: "chat-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-1"
    });
    const threadRegistry = createThreadRegistry();
    threadRegistry.register({
      chatId: "chat-1",
      threadName: "fix-retry",
      threadId: "thr-1",
      backend: createBackendIdentity("codex", "gpt-5-codex")
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: createAgentApiPool(codexApi) as never,
      threadRegistry: threadRegistry as never,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          model: "gpt-5-codex",
          backend: createBackendIdentity("codex", "gpt-5-codex")
        }))
      },
      userThreadBindingService
    });
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-1",
        chatId: "chat-1",
        userId: "u1",
        timestamp: 1,
        raw: {},
        type: "text" as const,
        text: "run command",
        mentions: [],
        traceId: "trace-1"
      })),
      sendMessage: vi.fn(async () => "msg-1")
    };

    const inbound = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "maintainer",
      headers: {},
      body: "{}",
      payload: {}
    });
    expect(inbound).toEqual({
      ok: true,
      result: {
        mode: "turn",
        id: "turn-1"
      }
    });

    orchestrator.registerApprovalRequest({
      chatId: "chat-1",
      userId: "u1",
      approvalId: "appr-2",
      threadId: "thr-1",
      threadName: "fix-retry",
      turnId: "turn-1",
      callId: "call-2",
      approvalType: "command_exec"
    });
    const result = await new ApprovalCallbackHandler(
      { save: vi.fn(async () => undefined) },
      {
        applyDecision: async (approvalId: string, action: "approve" | "deny" | "approve_always") => {
          const res = await orchestrator.handleApprovalDecision(
            approvalId,
            action === "approve" ? "accept" : action === "deny" ? "decline" : "approve_always"
          );
          return res === "duplicate" ? "duplicate" : "resolved";
        }
      }
    ).handle(
      {
        approvalId: "appr-2",
        approverId: "approver-1",
        action: "approve"
      },
      true
    );

    expect(result).toBe("applied");
    expect(codexApi.respondApproval).toHaveBeenCalledWith({
      action: "approve",
      approvalId: "appr-2",
      threadId: "thr-1",
      turnId: "turn-1",
      callId: "call-2",
      approvalType: "command_exec"
    });
  });

  it("runs approval callback chain for Claude ACP thread", async () => {
    const acpApi = {
      backendType: "acp" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "sess-claude-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } })),
      respondApproval: vi.fn(async () => undefined)
    };
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      chatId: "chat-claude",
      userId: "u1",
      threadName: "claude-fix",
      threadId: "sess-claude-1"
    });
    const threadRegistry = createThreadRegistry();
    threadRegistry.register({
      chatId: "chat-claude",
      threadName: "claude-fix",
      threadId: "sess-claude-1",
      backend: createBackendIdentity("claude-code", "claude-sonnet-4")
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: createAgentApiPool(acpApi) as never,
      threadRegistry: threadRegistry as never,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          model: "claude-sonnet-4",
          transport: "acp",
          backend: createBackendIdentity("claude-code", "claude-sonnet-4")
        }))
      },
      userThreadBindingService
    });

    await orchestrator.handleIntent(
      "proj-1",
      "chat-claude",
      { intent: "TURN_START", args: {} },
      "run command",
      "trace-1",
      "u1"
    );
    orchestrator.registerApprovalRequest({
      chatId: "chat-claude",
      userId: "u1",
      approvalId: "appr-claude-1",
      threadId: "sess-claude-1",
      threadName: "claude-fix",
      turnId: "turn-1",
      callId: "tool-1",
      approvalType: "command_exec"
    });

    const result = await new ApprovalCallbackHandler(
      { save: vi.fn(async () => undefined) },
      {
        applyDecision: async (approvalId: string, action: "approve" | "deny" | "approve_always") => {
          const res = await orchestrator.handleApprovalDecision(
            approvalId,
            action === "approve" ? "accept" : action === "deny" ? "decline" : "approve_always"
          );
          return res === "duplicate" ? "duplicate" : "resolved";
        }
      }
    ).handle(
      {
        approvalId: "appr-claude-1",
        approverId: "approver-1",
        action: "approve_always"
      },
      true
    );

    expect(result).toBe("applied");
    expect(acpApi.respondApproval).toHaveBeenCalledWith({
      action: "approve_always",
      approvalId: "appr-claude-1",
      threadId: "sess-claude-1",
      turnId: "turn-1",
      callId: "tool-1",
      approvalType: "command_exec"
    });
  });

  it("runs approval callback chain for OpenCode ACP file change", async () => {
    const acpApi = {
      backendType: "acp" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "sess-opencode-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } })),
      respondApproval: vi.fn(async () => undefined)
    };
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      chatId: "chat-opencode",
      userId: "u1",
      threadName: "opencode-fix",
      threadId: "sess-opencode-1"
    });
    const threadRegistry = createThreadRegistry();
    threadRegistry.register({
      chatId: "chat-opencode",
      threadName: "opencode-fix",
      threadId: "sess-opencode-1",
      backend: createBackendIdentity("opencode", "opencode-default")
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: createAgentApiPool(acpApi) as never,
      threadRegistry: threadRegistry as never,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          model: "opencode-default",
          transport: "acp",
          backend: createBackendIdentity("opencode", "opencode-default")
        }))
      },
      userThreadBindingService
    });

    await orchestrator.handleIntent(
      "proj-1",
      "chat-opencode",
      { intent: "TURN_START", args: {} },
      "apply patch",
      "trace-1",
      "u1"
    );
    orchestrator.registerApprovalRequest({
      chatId: "chat-opencode",
      userId: "u1",
      approvalId: "appr-opencode-1",
      threadId: "sess-opencode-1",
      threadName: "opencode-fix",
      turnId: "turn-1",
      callId: "tool-2",
      approvalType: "file_change"
    });

    const result = await new ApprovalCallbackHandler(
      { save: vi.fn(async () => undefined) },
      {
        applyDecision: async (approvalId: string, action: "approve" | "deny" | "approve_always") => {
          const res = await orchestrator.handleApprovalDecision(
            approvalId,
            action === "approve" ? "accept" : action === "deny" ? "decline" : "approve_always"
          );
          return res === "duplicate" ? "duplicate" : "resolved";
        }
      }
    ).handle(
      {
        approvalId: "appr-opencode-1",
        approverId: "approver-1",
        action: "deny"
      },
      true
    );

    expect(result).toBe("applied");
    expect(acpApi.respondApproval).toHaveBeenCalledWith({
      action: "deny",
      approvalId: "appr-opencode-1",
      threadId: "sess-opencode-1",
      turnId: "turn-1",
      callId: "tool-2",
      approvalType: "file_change"
    });
  });

  it("keeps thread backend metadata immutable across bind/resolve", async () => {
    const userThreadBindingService = new UserThreadBindingService();

    await userThreadBindingService.bind({
      chatId: "chat-1",
      userId: "owner",
      threadName: "claude-fix",
      threadId: "sess-1"
    });

    const reviewerBinding = await userThreadBindingService.resolve("chat-1", "owner");

    expect(reviewerBinding).toMatchObject({
      threadName: "claude-fix",
      threadId: "sess-1"
    });
  });

  it("preserves backend metadata when thread id is rebound after resume", async () => {
    const codexApi = {
      backendType: "acp" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "sess-new" } })),
      threadResume: vi.fn(async () => ({ thread: { id: "sess-old" } })),
      turnStart: vi.fn(async ({ threadId }: { threadId: string }) => {
        if (threadId === "sess-old") {
          throw new Error("thread not found");
        }
        return { turn: { id: "turn-1" } };
      })
    };
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      chatId: "chat-1",
      userId: "u1",
      threadName: "claude-fix",
      threadId: "sess-old"
    });
    const threadRegistry = createThreadRegistry();
    threadRegistry.register({
      chatId: "chat-1",
      threadName: "claude-fix",
      threadId: "sess-old",
      backend: createBackendIdentity("claude-code", "claude-sonnet-4")
    });
    const getProjectRuntimeConfig = vi.fn(async () => ({
      model: "claude-sonnet-4",
      transport: "acp",
      backend: createBackendIdentity("claude-code", "claude-sonnet-4")
    }));
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: createAgentApiPool(codexApi) as never,
      threadRegistry: threadRegistry as never,
      runtimeConfigProvider: {
        getProjectRuntimeConfig
      },
      userThreadBindingService
    });

    let callCount = 0;
    codexApi.turnStart.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error("thread not found");
      return { turn: { id: "turn-1" } };
    });

    const result = await orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "resume please");
    const rebound = await userThreadBindingService.resolve("chat-1", "u1");
    const record = threadRegistry.get("chat-1", "claude-fix");

    expect(result).toEqual({ threadId: "sess-old", turnId: "turn-1" });
    expect(codexApi.threadResume).toHaveBeenCalledWith("sess-old", expect.objectContaining({
      model: "claude-sonnet-4",
      transport: "acp"
    }));
    expect(getProjectRuntimeConfig).toHaveBeenCalledWith("proj-1", "u1");
    expect(rebound).toMatchObject({
      threadName: "claude-fix",
      threadId: "sess-old"
    });
    expect(record?.backend).toEqual(createBackendIdentity("claude-code", "claude-sonnet-4"));
  });

  it("blocks __system__ session from starting coding turn on main branch", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const userThreadBindingService = new UserThreadBindingService();
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: createAgentApiPool(codexApi) as never,
      threadRegistry: createThreadRegistry() as never,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          model: "gpt-5-codex",
          backend: createBackendIdentity("codex", "gpt-5-codex")
        }))
      },
      userThreadBindingService
    });

    await expect(
      orchestrator.handleIntent("proj-1", "chat-1", { intent: "TURN_START", args: {} }, "system task")
    ).rejects.toThrow("请先 /thread new 或 /thread join");
    expect(codexApi.threadStart).not.toHaveBeenCalled();
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });
});
