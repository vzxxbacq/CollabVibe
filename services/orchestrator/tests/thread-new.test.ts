import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator } from "../src/orchestrator";
import { ThreadBindingService } from "../src/thread-binding-service";
import { MemoryBindingRepository } from "./fixtures/memory-binding-repo";

describe("/thread new command", () => {
  it("creates a new thread and overwrites old mapping", async () => {
    const repo = new MemoryBindingRepository([{ projectId: "proj-1", chatId: "chat-1", threadId: "thr-old" }]);

    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-unused" } }))
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
      threadBindingService: new ThreadBindingService(repo)
    });

    const created = await orchestrator.handleThreadNew("proj-1", "chat-1");
    expect(created.threadId).toBe("thr-new");

    await expect(repo.get("proj-1", "chat-1")).resolves.toEqual({
      projectId: "proj-1",
      chatId: "chat-1",
      threadId: "thr-new"
    });
  });
});
