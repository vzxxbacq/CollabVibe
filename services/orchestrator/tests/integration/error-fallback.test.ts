import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator, UserThreadBindingService } from "../../src/index";
import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../helpers/test-runtime";

describe("orchestrator error fallback", () => {
  it("does not start turn when explicit thread creation fails", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => {
        throw new Error("thread/start failed");
      }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const userThreadBindingService = new UserThreadBindingService();

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({
        model: "gpt-5-codex",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest"
      }),
      userThreadBindingService,
      threadRegistry: await createTestThreadRegistry()
    });

    await expect(
      orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
        backendId: "codex",
        model: "gpt-5-codex"
      })
    ).rejects.toThrow("thread/start failed");
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });

  it("keeps selected binding when active-thread startup fails", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => {
        throw new Error("turn/start timeout");
      })
    };
    const threadRegistry = await createTestThreadRegistry();
    const userThreadBindingService = new UserThreadBindingService();
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "fix-retry",
      threadId: "thr-existing",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
    });
    await userThreadBindingService.bind({
      projectId: "chat-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-existing",
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({
        model: "gpt-5-codex",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest"
      }),
      userThreadBindingService,
      threadRegistry
    });

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "continue")).rejects.toThrow("agent api unavailable");
    await expect(userThreadBindingService.resolve("chat-1", "u1")).resolves.toMatchObject({
      threadName: "fix-retry",
      threadId: "thr-existing"
    });
    expect(codexApi.threadStart).not.toHaveBeenCalled();
  });

  it("stops before exposing user binding when thread creation binding metadata fails", async () => {
    class BindFailsUserThreadBindingService extends UserThreadBindingService {
      override async bind(): Promise<void> {
        throw new Error("bind failed");
      }
    }

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
      userThreadBindingService: new BindFailsUserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });

    await expect(
      orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
        backendId: "codex",
        model: "gpt-5-codex"
      })
    ).rejects.toThrow("bind failed");
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });

  it("stops before thread start on deprecated main-branch path", async () => {
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

    await expect(orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "hello")).rejects.toThrow("请先 /thread new 或 /thread join");
    expect(codexApi.threadStart).not.toHaveBeenCalled();
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });
});
