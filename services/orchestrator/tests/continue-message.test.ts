import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator } from "../src/orchestrator";
import { ThreadBindingService } from "../src/thread-binding-service";
import type { ThreadBinding, ThreadBindingRepository } from "../src/types";

class PreboundRepository implements ThreadBindingRepository {
  async get(): Promise<ThreadBinding | null> {
    return {
      projectId: "proj-1",
      chatId: "chat-1",
      threadId: "thr-existing"
    };
  }

  async set(): Promise<void> {
    return;
  }

  async delete(): Promise<void> {
    return;
  }
}

describe("orchestrator continue message", () => {
  it("reuses existing thread and only starts turn", async () => {
    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-2" } }))
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
      threadBindingService: new ThreadBindingService(new PreboundRepository())
    });

    const result = await orchestrator.handleUserText("proj-1", "chat-1", "continue");

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
