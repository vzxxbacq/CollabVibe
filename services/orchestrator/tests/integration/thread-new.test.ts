import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator, UserThreadBindingService } from "../../src/index";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";
import { makeAgentApiPool, makeRuntimeConfigProvider } from "../helpers/test-runtime";

describe("/thread new command (via createThread)", () => {
  it("creates a new thread with all registrations", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-unused" } }))
    };

    const threadRegistry = await createTestThreadRegistry();
    const userThreadBindingService = new UserThreadBindingService();

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makeAgentApiPool(codexApi),
      runtimeConfigProvider: makeRuntimeConfigProvider({
        cwd: "",
        model: "gpt-5-codex",
        sandbox: "workspace-write",
        approvalPolicy: "onRequest"
      }),
      userThreadBindingService,
      threadRegistry
    });

    const created = await orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
      backendId: "codex",
      model: "gpt-5-codex"
    });
    expect(created.threadId).toBe("thr-new");
    expect(created.threadName).toBe("fix-retry");

    // Verify ThreadRegistry got populated
    const record = threadRegistry.get("chat-1", "fix-retry");
    expect(record).not.toBeNull();
    expect(record?.backend.backendId).toBe("codex");

    // Verify UserThreadBinding got populated
    const binding = await userThreadBindingService.resolve("chat-1", "u1");
    expect(binding?.threadName).toBe("fix-retry");
    expect(binding?.threadId).toBe("thr-new");
  });
});
