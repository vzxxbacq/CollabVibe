import { describe, expect, it, vi } from "vitest";

import type { ParsedIntent } from "../../../../packages/channel-core/src/types";
import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import { ConversationOrchestrator, UserThreadBindingService } from "../../src/index";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";

vi.mock("../../../../packages/git-utils/src/worktree", () => ({
  getWorktreePath: vi.fn((cwd: string, threadName: string) => `${cwd}/.worktrees/${threadName}`),
  createWorktree: vi.fn(async () => undefined),
  ensurePluginSymlink: vi.fn(async () => undefined),
  listWorktrees: vi.fn(async () => [])
}));

function makeIntent(intent: ParsedIntent["intent"]): ParsedIntent {
  return {
    intent,
    args: {}
  };
}

async function makeOrchestrator(codexApi: Record<string, unknown>, opts?: { withBinding?: boolean }) {
  const userThreadBindingService = new UserThreadBindingService();
  const threadRegistry = await createTestThreadRegistry();
  const runtimeConfigProvider = {
    getProjectRuntimeConfig: vi.fn(async () => ({
      cwd: "/repos/payment",
      model: "gpt-5-codex",
      sandbox: "workspace-write",
      approvalPolicy: "onRequest",
      backend: createBackendIdentity("codex", "gpt-5-codex")
    }))
  };
  const orchestrator = new ConversationOrchestrator({
    agentApiPool: {
      createWithConfig: vi.fn(async () => codexApi as never),
      get: vi.fn(() => codexApi as never),
      releaseThread: vi.fn(async () => undefined),
      releaseAll: vi.fn(async () => undefined),
      healthCheck: vi.fn(async () => ({ alive: true, threadCount: 1 }))
    },
    runtimeConfigProvider,
    userThreadBindingService,
    threadRegistry
  });
  return { orchestrator, userThreadBindingService, threadRegistry, runtimeConfigProvider };
}

describe("orchestrator handleIntent", () => {


  it("routes TURN_START to user text flow", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const { orchestrator } = await makeOrchestrator(codexApi);

    // Use createThread to set up binding
    await orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
      backendId: "codex",
      model: "gpt-5-codex"
    });

    const result = await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("TURN_START"), "fix retry logic", undefined, "u1");

    expect(result).toEqual({ mode: "turn", id: "turn-1" });
    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      input: [{ type: "text", text: "fix retry logic" }]
    });
  });

  it("rejects unsupported non-agent intents", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const { orchestrator } = await makeOrchestrator(codexApi);

    await orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
      backendId: "codex",
      model: "gpt-5-codex"
    });

    await expect(
      orchestrator.handleIntent("proj-1", "chat-1", makeIntent("SKILL_LIST"), "hello", undefined, "u1")
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_INTENT"
    });
    expect(codexApi.turnStart).not.toHaveBeenCalled();
  });

  it("passes traceId through handleIntent to turnStart", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };

    const { orchestrator } = await makeOrchestrator(codexApi);

    await orchestrator.createThread("proj-1", "chat-1", "u1", "fix-retry", {
      backendId: "codex",
      model: "gpt-5-codex"
    });

    await orchestrator.handleIntent("proj-1", "chat-1", makeIntent("TURN_START"), "hello", "trace-handle-intent", "u1");

    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      traceId: "trace-handle-intent",
      input: [{ type: "text", text: "hello" }]
    });
  });

  it("normalizes legacy sandbox value before thread/start (via createThread)", async () => {
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-unused" } }))
    };

    const { orchestrator } = await makeOrchestrator(codexApi);

    await orchestrator.createThread("proj-1", "chat-1", "u1", "my-thread", {
      backendId: "codex",
      model: "gpt-5-codex"
    });

    // Verify threadStart was called with the built config
    expect(codexApi.threadStart).toHaveBeenCalledWith(
      expect.objectContaining({
        sandbox: "workspace-write",
        approvalPolicy: "onRequest",
        backend: expect.objectContaining({
          backendId: "codex",
          model: "gpt-5-codex",
          transport: "codex"
        })
      })
    );
  });
});
