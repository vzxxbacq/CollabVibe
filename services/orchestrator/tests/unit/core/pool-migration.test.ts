import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator } from "../../../src/index";
import { UserThreadBindingService } from "../../../src/index";
import { createTestThreadRegistry } from "../../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../../helpers/test-runtime";

function makePoolFrom(codexApi: Record<string, unknown>) {
  return makeAgentApiPool(codexApi);
}

describe("pool-migration", () => {
  it("throws explicit error when pool has no api for chat", async () => {
    const userThreadBindingService = new UserThreadBindingService();
    await userThreadBindingService.bind({
      chatId: "chat-1",
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

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "hello")).rejects.toThrowError(
      "agent api unavailable for chat chat-1"
    );
  });

  it("routes different chats to isolated codex instances", async () => {
    const chatCalls: string[] = [];
    const codexApiByChat = new Map([
      [
        "chat-a",
        {
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
        get: vi.fn(() => null),
        releaseThread: vi.fn(async () => undefined),
        healthCheck: vi.fn(async () => ({ alive: true, threadCount: 1 }))
      },
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });

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
