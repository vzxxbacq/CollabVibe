import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator } from "../src/orchestrator";
import { ThreadBindingService } from "../src/thread-binding-service";
import type { ThreadBindingRepository } from "../src/types";
import { MemoryBindingRepository } from "./fixtures/memory-binding-repo";

function runtimeConfigProvider() {
  return {
    getProjectRuntimeConfig: vi.fn(async () => ({
      cwd: "/repos/payment",
      model: "gpt-5-codex",
      sandbox: "workspaceWrite",
      approvalPolicy: "onRequest"
    }))
  };
}

describe("orchestrator error fallback", () => {
  it("does not start turn when thread creation fails", async () => {
    const repo = new MemoryBindingRepository();
    const codexApi = {
      threadStart: vi.fn(async () => {
        throw new Error("thread/start failed");
      }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: runtimeConfigProvider(),
      threadBindingService: new ThreadBindingService(repo)
    });

    await expect(orchestrator.handleUserText("proj-1", "chat-1", "hello")).rejects.toThrow("thread/start failed");
    expect(codexApi.turnStart).not.toHaveBeenCalled();
    await expect(repo.get("proj-1", "chat-1")).resolves.toBeNull();
  });

  it("rolls back newly created binding when turn start fails", async () => {
    const repo = new MemoryBindingRepository();
    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => {
        throw new Error("turn/start timeout");
      })
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: runtimeConfigProvider(),
      threadBindingService: new ThreadBindingService(repo)
    });

    await expect(orchestrator.handleUserText("proj-1", "chat-1", "hello")).rejects.toThrow("turn/start timeout");
    await expect(repo.get("proj-1", "chat-1")).resolves.toBeNull();
  });

  it("keeps existing binding when turn start fails on a resumed thread", async () => {
    const repo = new MemoryBindingRepository([{ projectId: "proj-1", chatId: "chat-1", threadId: "thr-existing" }]);
    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => {
        throw new Error("turn/start timeout");
      })
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: runtimeConfigProvider(),
      threadBindingService: new ThreadBindingService(repo)
    });

    await expect(orchestrator.handleUserText("proj-1", "chat-1", "continue")).rejects.toThrow("turn/start timeout");
    await expect(repo.get("proj-1", "chat-1")).resolves.toEqual({
      projectId: "proj-1",
      chatId: "chat-1",
      threadId: "thr-existing"
    });
    expect(codexApi.threadStart).not.toHaveBeenCalled();
  });

  it("stops before turn start when binding fails", async () => {
    class BindFailsRepository implements ThreadBindingRepository {
      async get() {
        return null;
      }

      async set() {
        throw new Error("bind failed");
      }

      async delete() {
        return;
      }
    }

    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: runtimeConfigProvider(),
      threadBindingService: new ThreadBindingService(new BindFailsRepository())
    });

    await expect(orchestrator.handleUserText("proj-1", "chat-1", "hello")).rejects.toThrow("bind failed");
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });
});
