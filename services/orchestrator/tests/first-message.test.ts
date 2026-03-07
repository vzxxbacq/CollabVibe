import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator } from "../src/orchestrator";
import { ThreadBindingService } from "../src/thread-binding-service";
import { MemoryBindingRepository } from "./fixtures/memory-binding-repo";

describe("orchestrator first message", () => {
  it("creates thread then starts turn for new chat", async () => {
    const calls: string[] = [];
    const codexApi = {
      threadStart: vi.fn(async () => {
        calls.push("thread/start");
        return { thread: { id: "thr-1" } };
      }),
      turnStart: vi.fn(async () => {
        calls.push("turn/start");
        return { turn: { id: "turn-1" } };
      })
    };

    const configProvider = {
      getProjectRuntimeConfig: vi.fn(async () => ({
        cwd: "/repos/payment",
        model: "gpt-5-codex",
        sandbox: "workspaceWrite",
        approvalPolicy: "onRequest"
      }))
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: configProvider,
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
    });

    const result = await orchestrator.handleUserText("proj-1", "chat-1", "fix retry");

    expect(result).toEqual({ threadId: "thr-1", turnId: "turn-1" });
    expect(calls).toEqual(["thread/start", "turn/start"]);
  });

  it("passes traceId to turn start when provided", async () => {
    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          cwd: "/repos/payment",
          model: "gpt-5-codex",
          sandbox: "workspaceWrite",
          approvalPolicy: "onRequest"
        }))
      },
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
    });

    await orchestrator.handleUserText("proj-1", "chat-1", "fix retry", "trace-1");

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

  it("does not create duplicate threads under concurrent calls", async () => {
    let resolveThreadStart: (() => void) | null = null;
    const threadStartBlocked = new Promise<void>((resolve) => {
      resolveThreadStart = resolve;
    });

    const codexApi = {
      threadStart: vi.fn(async () => {
        await threadStartBlocked;
        return { thread: { id: "thr-1" } };
      }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: {
        getProjectRuntimeConfig: vi.fn(async () => ({
          cwd: "/repos/payment",
          model: "gpt-5-codex",
          sandbox: "workspaceWrite",
          approvalPolicy: "onRequest"
        }))
      },
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
    });

    const concurrent = Promise.all([
      orchestrator.handleUserText("proj-1", "chat-1", "msg1"),
      orchestrator.handleUserText("proj-1", "chat-1", "msg2")
    ]);

    await Promise.resolve();
    await Promise.resolve();
    resolveThreadStart?.();

    const results = await concurrent;
    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
    expect(results[0].threadId).toBe(results[1].threadId);
  });
});
