import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator, UserThreadBindingService } from "../../src/index";
import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../helpers/test-runtime";

describe("orchestrator continue message", () => {
  it("reuses selected user thread and only starts turn", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-2" } }))
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
      chatId: "chat-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-existing",
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({
        cwd: "/repos/payment",
        model: "gpt-5-codex",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest"
      }),
      userThreadBindingService,
      threadRegistry
    });

    const result = await orchestrator.handleUserTextForUser("proj-1", "chat-1", "u1", "continue");

    expect(result.threadId).toBe("thr-existing");
    expect(codexApi.threadStart).not.toHaveBeenCalled();
    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-existing",
      input: [
        {
          type: "text",
          text: "continue"
        }
      ]
    });
  });
});
