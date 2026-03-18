import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator, UserThreadBindingService } from "../../src/index";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../helpers/test-runtime";

describe("orchestrator first message", () => {
  it("does not auto-create a main-branch thread for new chat", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "fix retry")).rejects.toThrowError(
      "请先 /thread new 或 /thread join"
    );
    expect(codexApi.threadStart).not.toHaveBeenCalled();
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });

  it("starts turn after explicit thread creation and selection", async () => {
    const calls: string[] = [];
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => {
        calls.push("thread/start");
        return { thread: { id: "thr-1" } };
      }),
      turnStart: vi.fn(async () => {
        calls.push("turn/start");
        return { turn: { id: "turn-1" } };
      })
    };

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({
        model: "gpt-5-codex",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest"
      }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });

    await orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
      backendId: "codex",
      model: "gpt-5-codex"
    });
    const result = await orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "fix retry");

    expect(result).toEqual({ threadId: "thr-1", turnId: "turn-1" });
    expect(calls).toEqual(["thread/start", "turn/start"]);
  });

  it("passes traceId to turn start when thread is explicitly selected", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({
        model: "gpt-5-codex",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest"
      }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });

    await orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
      backendId: "codex",
      model: "gpt-5-codex"
    });
    await orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "fix retry", "trace-1");

    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      traceId: "trace-1",
      input: [
        {
          type: "text",
          text: "fix retry"
        }
      ]
    });
  });
});
