import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator, UserThreadBindingService } from "../../../src/index";
import { createBackendIdentity } from "../../../../../packages/agent-core/src/backend-identity";
import { createTestThreadRegistry } from "../../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../../helpers/test-runtime";

describe("state-machine integration", () => {
  it("forwards approval decisions to the active backend session", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } })),
      respondApproval: vi.fn(async () => undefined)
    };
    const threadRegistry = await createTestThreadRegistry();
    const userThreadBindingService = new UserThreadBindingService();
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "fix-retry",
      threadId: "thr-1",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
    });
    await userThreadBindingService.bind({
      projectId: "chat-1",
      chatId: "chat-1",
      userId: "u1",
      threadName: "fix-retry",
      threadId: "thr-1"
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi, { cached: codexApi, alive: true, threadCount: 1 }),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService,
      threadRegistry
    });

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

    await orchestrator.handleApprovalDecision("appr-1", "accept");
    expect(codexApi.respondApproval).toHaveBeenCalled();
  });

  it("requires an active user binding when no userId is provided", async () => {
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(null, { cached: null, alive: false, threadCount: 0 }),
      runtimeConfigProvider: makeRuntimeConfigProvider({ model: "gpt-5-codex" }),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry: await createTestThreadRegistry()
    });

    await expect(
      orchestrator.handleIntent("proj-1", "chat-1", { intent: "TURN_START", args: {} }, "hello")
    ).rejects.toThrowError("请先 /thread new 或 /thread join");
  });
});
