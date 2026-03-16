import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator, UserThreadBindingService } from "../../../src/index";
import { createTestThreadRegistry } from "../../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../../helpers/test-runtime";

function makePoolFrom(codexApi: unknown) {
  return makeAgentApiPool(codexApi);
}

describe("thread-manual", () => {
  it("rejects user text when thread is not selected", async () => {
    const userThreadBinding = new UserThreadBindingService();
    const codexApi = {
      backendType: "codex",
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: userThreadBinding,
      threadRegistry: await createTestThreadRegistry()
    });

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "hello")).rejects.toThrowError(
      "请先 /thread new 或 /thread join"
    );
  });

  it("supports thread join/switch/list/leave commands", async () => {
    const userThreadBinding = new UserThreadBindingService();
    const codexApi = {
      backendType: "codex",
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: userThreadBinding,
      threadRegistry: await createTestThreadRegistry()
    });

    const created = await orchestrator.createThread(
      "proj-1",
      "chat-1",
      "u1",
      "fix-retry",
      { backendId: "codex", model: "gpt-5-codex" }
    );
    expect(created.threadId).toBe("thr-new");

    const listed = await orchestrator.handleThreadList("chat-1");
    expect(listed).toEqual([{ threadName: "fix-retry", threadId: "thr-new" }]);

    const joined = await orchestrator.handleThreadJoin("chat-1", "u2", "fix-retry");
    expect(joined).toEqual({ threadName: "fix-retry", threadId: "thr-new" });

    await orchestrator.handleThreadLeave("chat-1", "u2");
    await expect(userThreadBinding.resolve("chat-1", "u2")).resolves.toBeNull();
  });

  it("rejects duplicate thread name in the same project", async () => {
    const userThreadBinding = new UserThreadBindingService();
    const codexApi = {
      backendType: "codex",
      threadStart: vi.fn(async () => ({ thread: { id: `thr-${Date.now()}` } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: userThreadBinding,
      threadRegistry: await createTestThreadRegistry()
    });

    await orchestrator.createThread("proj-1", "chat-1", "u1", "dup-thread", { backendId: "codex", model: "gpt-5-codex" });

    await expect(
      orchestrator.createThread("proj-1", "chat-1", "u1", "dup-thread", { backendId: "codex", model: "gpt-5-codex" })
    ).rejects.toThrowError(/已存在/);
  });

  it("blocks concurrent duplicate creation while the first thread is still creating", async () => {
    const userThreadBinding = new UserThreadBindingService();
    let markStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const codexApi = {
      backendType: "codex",
      threadStart: vi.fn(async () => {
        markStarted();
        await releasePromise;
        return { thread: { id: "thr-concurrent-1" } };
      }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: userThreadBinding,
      threadRegistry: await createTestThreadRegistry()
    });

    const first = orchestrator.createThread("proj-1", "chat-1", "u1", "same-thread", { backendId: "codex", model: "gpt-5-codex" });
    await firstStarted;

    await expect(
      orchestrator.createThread("proj-1", "chat-1", "u2", "same-thread", { backendId: "codex", model: "gpt-5-codex" })
    ).rejects.toThrowError(/已存在/);

    releaseFirst();
    await expect(first).resolves.toMatchObject({ threadId: "thr-concurrent-1", threadName: "same-thread" });
    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
  });

  it("releases a failed reservation so the same name can be retried", async () => {
    const userThreadBinding = new UserThreadBindingService();
    const codexApi = {
      backendType: "codex",
      threadStart: vi
        .fn()
        .mockRejectedValueOnce(new Error("backend start failed"))
        .mockResolvedValueOnce({ thread: { id: "thr-retry-ok" } }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: userThreadBinding,
      threadRegistry: await createTestThreadRegistry()
    });

    await expect(
      orchestrator.createThread("proj-1", "chat-1", "u1", "retry-thread", { backendId: "codex", model: "gpt-5-codex" })
    ).rejects.toThrowError("backend start failed");

    await expect(
      orchestrator.createThread("proj-1", "chat-1", "u1", "retry-thread", { backendId: "codex", model: "gpt-5-codex" })
    ).resolves.toMatchObject({ threadId: "thr-retry-ok", threadName: "retry-thread" });
  });
});
