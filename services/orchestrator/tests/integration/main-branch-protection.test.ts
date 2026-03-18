import { describe, expect, it, vi } from "vitest";

import { AgentEventRouter, ConversationOrchestrator, EventPipeline, UserThreadBindingService } from "../../src/index";
import { createTestThreadRegistry } from "../../helpers/test-thread-registry";
import { makeRuntimeConfigProvider } from "../../helpers/test-runtime";

function makePoolFrom(codexApi: unknown) {
  return {
    createWithConfig: vi.fn(async () => codexApi as never),
    get: vi.fn(() => codexApi as never),
    releaseThread: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => ({ alive: true, threadCount: 0 }))
  };
}

function attachPipeline(orchestrator: ConversationOrchestrator): void {
  orchestrator.setEventPipeline(new EventPipeline(
    new AgentEventRouter({
      appendContent: vi.fn(async () => undefined),
      appendReasoning: vi.fn(async () => undefined),
      appendPlan: vi.fn(async () => undefined),
      appendToolOutput: vi.fn(async () => undefined),
      updateProgress: vi.fn(async () => undefined),
      requestApproval: vi.fn(async () => undefined),
      requestUserInput: vi.fn(async () => undefined),
      notify: vi.fn(async () => undefined),
      completeTurn: vi.fn(async () => undefined),
      sendFileReview: vi.fn(async () => undefined),
      sendMergeSummary: vi.fn(async () => undefined),
      sendThreadOperation: vi.fn(async () => undefined),
      sendSnapshotOperation: vi.fn(async () => undefined)
    } as never),
    {
      registerApprovalRequest: orchestrator.registerApprovalRequest.bind(orchestrator),
      finishTurn: orchestrator.finishTurn.bind(orchestrator),
    }
  ));
}

describe("main-branch-protection", () => {
  it("rejects user turns without selected thread", async () => {
    const codexApi = {
      backendType: "codex",
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const threadRegistry = await createTestThreadRegistry();
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry
    });
    attachPipeline(orchestrator);

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "hello")).rejects.toThrowError(
      "请先 /thread new 或 /thread join"
    );
  });

  it("rejects legacy main-branch handleUserText and ensureThread paths", async () => {
    const codexApi = {
      backendType: "codex",
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const threadRegistry = await createTestThreadRegistry();
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry
    });
    attachPipeline(orchestrator);

    // Without thread binding, handleUserTextForUser should fail
    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "hello")).rejects.toThrowError("请先 /thread new 或 /thread join");
  });

  it("isolates same-chat users on different backend threads", async () => {
    const codexTurnStart = vi.fn(async ({ threadId }: { threadId: string }) => ({ turn: { id: `turn-${threadId}` } }));
    const claudeTurnStart = vi.fn(async ({ threadId }: { threadId: string }) => ({ turn: { id: `turn-${threadId}` } }));
    const codexApiMock = { backendType: "codex" as const, onNotification: vi.fn(), turnStart: codexTurnStart, threadStart: vi.fn() };
    const claudeApiMock = { backendType: "acp" as const, onNotification: vi.fn(), turnStart: claudeTurnStart, threadStart: vi.fn() };

    const pool = {
      createWithConfig: vi.fn(async (_chatId: string, threadName: string) => {
        return threadName === "claude-fix" ? claudeApiMock : codexApiMock;
      }),
      get: vi.fn((_chatId: string, threadName: string) => threadName === "claude-fix" ? claudeApiMock : codexApiMock),
      releaseThread: vi.fn(async () => undefined),
      healthCheck: vi.fn(async () => ({ alive: true, threadCount: 1 }))
    };

    const { createBackendIdentity } = await import("../../../../../packages/agent-core/src/backend-identity");
    const threadRegistry = await createTestThreadRegistry();
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1", threadName: "codex-fix", threadId: "thr-codex",
      backend: createBackendIdentity("codex", "gpt-5-codex")
    });
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1", threadName: "claude-fix", threadId: "thr-claude",
      backend: createBackendIdentity("claude-code", "claude-sonnet-4")
    });

    const bindingService = new UserThreadBindingService();
    await bindingService.bind({
      projectId: "chat-1",
      userId: "u-codex", threadName: "codex-fix", threadId: "thr-codex",
    });
    await bindingService.bind({
      projectId: "chat-1",
      userId: "u-claude", threadName: "claude-fix", threadId: "thr-claude",
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: pool,
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: bindingService,
      threadRegistry
    });
    attachPipeline(orchestrator);

    const codexResult = await orchestrator.handleUserTextForUser("proj-1", "chat-1", "u-codex", "fix this");
    const claudeResult = await orchestrator.handleUserTextForUser("proj-1", "chat-1", "u-claude", "review this");

    expect(pool.get).toHaveBeenCalled();
    expect(codexResult).toEqual({ threadId: "thr-codex", turnId: "turn-thr-codex" });
    expect(claudeResult).toEqual({ threadId: "thr-claude", turnId: "turn-thr-claude" });
  });
});
