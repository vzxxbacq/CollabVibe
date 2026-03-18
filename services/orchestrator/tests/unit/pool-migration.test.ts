import { describe, expect, it, vi } from "vitest";

import { AgentEventRouter, ConversationOrchestrator, EventPipeline } from "../../src/index";
import { UserThreadBindingService } from "../../src/index";
import { createTestThreadRegistry } from "../../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../../helpers/test-runtime";

function makePoolFrom(codexApi: Record<string, unknown>) {
  return makeAgentApiPool(codexApi);
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

describe("pool-migration", () => {
  it("throws explicit error when pool has no api for chat", async () => {
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      projectId: "chat-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-1"
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(null, { cached: null, alive: false, threadCount: 0 }),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService,
      threadRegistry: await createTestThreadRegistry()
    });
    attachPipeline(orchestrator);

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "hello")).rejects.toThrowError(
      "agent api unavailable for project-thread chat-1/fix-retry"
    );
  });

  it("routes different chats to isolated codex instances", async () => {
    const chatCalls: string[] = [];
    const codexApiByChat = new Map([
      [
        "chat-a",
        {
          onNotification: vi.fn(),
          threadStart: vi.fn(async () => ({ thread: { id: "thr-a" } })),
          turnStart: vi.fn(async () => {
            chatCalls.push("chat-a");
            return { turn: { id: "turn-a" } };
          })
        }
      ],
      [
        "chat-b",
        {
          onNotification: vi.fn(),
          threadStart: vi.fn(async () => ({ thread: { id: "thr-b" } })),
          turnStart: vi.fn(async () => {
            chatCalls.push("chat-b");
            return { turn: { id: "turn-b" } };
          })
        }
      ]
    ]);

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: {
        createWithConfig: vi.fn(async (chatId: string) => codexApiByChat.get(chatId) as never),
        get: vi.fn((chatId: string) => codexApiByChat.get(chatId) as never),
        releaseThread: vi.fn(async () => undefined),
        healthCheck: vi.fn(async () => ({ alive: true, threadCount: 1 }))
      },
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });
    attachPipeline(orchestrator);

    await orchestrator.createThread("proj-a", "chat-a", "u1", "fix-a", {
      backendId: "codex",
      model: "gpt-5-codex"
    });
    await orchestrator.createThread("proj-b", "chat-b", "u1", "fix-b", {
      backendId: "codex",
      model: "gpt-5-codex"
    });

    const [first, second] = await Promise.all([
      orchestrator.handleUserTextForUser("proj-a", "chat-a", "u1", "hello"),
      orchestrator.handleUserTextForUser("proj-b", "chat-b", "u1", "world")
    ]);

    expect(first).toEqual({ threadId: "thr-a", turnId: "turn-a" });
    expect(second).toEqual({ threadId: "thr-b", turnId: "turn-b" });
    expect(chatCalls.sort()).toEqual(["chat-a", "chat-b"]);
  });
});
