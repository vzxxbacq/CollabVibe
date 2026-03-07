import { describe, expect, it, vi } from "vitest";

import type { ParsedIntent } from "../../../packages/channel-core/src/types";
import { ConversationOrchestrator } from "../src/orchestrator";
import { ThreadBindingService } from "../src/thread-binding-service";
import { MemoryBindingRepository } from "./fixtures/memory-binding-repo";

function makeIntent(intent: ParsedIntent["intent"]): ParsedIntent {
  return {
    intent,
    args: {}
  };
}

describe("orchestrator handleIntent", () => {
  it("routes THREAD_NEW to thread creation flow", async () => {
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
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
    });

    const result = await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("THREAD_NEW"), "ignored");

    expect(result).toEqual({ mode: "thread", id: "thr-new" });
    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });

  it("routes TURN_START to user text flow", async () => {
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

    const result = await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("TURN_START"), "fix retry logic");

    expect(result).toEqual({ mode: "turn", id: "turn-1" });
    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      input: [{ type: "text", text: "fix retry logic" }]
    });
  });

  it("falls back to user text flow for unsupported intent", async () => {
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

    const result = await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("SKILL_LIST"), "hello");

    expect(result).toEqual({ mode: "turn", id: "turn-1" });
    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      input: [{ type: "text", text: "hello" }]
    });
  });

  it("passes traceId through handleIntent to turnStart", async () => {
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

    await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("TURN_START"), "hello", "trace-handle-intent");

    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      traceId: "trace-handle-intent",
      input: [{ type: "text", text: "hello" }]
    });
  });

  it("normalizes legacy sandbox value before thread/start", async () => {
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
          sandbox: "workspace-write",
          approvalPolicy: "onRequest"
        }))
      },
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
    });

    await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("THREAD_NEW"), "ignored");

    expect(codexApi.threadStart).toHaveBeenCalledWith({
      cwd: "/repos/payment",
      model: "gpt-5-codex",
      sandbox: "workspaceWrite",
      approvalPolicy: "onRequest"
    });
  });
});
