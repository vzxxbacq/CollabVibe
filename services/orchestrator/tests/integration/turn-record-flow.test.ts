import { describe, expect, it, vi } from "vitest";

import { ConversationOrchestrator } from "../../src/orchestrator";
import { InMemoryTurnRepository } from "../../src/turn-state/turn-repository";
import { InMemoryThreadTurnStateRepository } from "../../src/thread-state/thread-turn-state-repository";
import { UserThreadBindingService } from "../../src/thread-state/user-thread-binding-service";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";
import { makeRuntimeConfigProvider } from "../helpers/test-runtime";
import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";

describe("turn-record flow", () => {
  it("derives pending approval from TurnRecord + ThreadTurnState and clears it on accept", async () => {
    const turnRepository = new InMemoryTurnRepository();
    const threadTurnStateRepository = new InMemoryThreadTurnStateRepository();
    const threadRegistry = await createTestThreadRegistry();
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "m25",
      threadId: "thr-m25",
      backend: createBackendIdentity("codex", "gpt-5")
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: {
        createWithConfig: vi.fn(),
        get: vi.fn(() => null),
        releaseThread: vi.fn(async () => undefined),
        healthCheck: vi.fn(async () => ({ alive: true, threadCount: 0 }))
      },
      runtimeConfigProvider: makeRuntimeConfigProvider(),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry,
      turnRepository,
      threadTurnStateRepository,
    });

    await turnRepository.create({
      chatId: "chat-1",
      projectId: "chat-1",
      threadName: "m25",
      threadId: "thr-m25",
      turnId: "turn-1",
      status: "awaiting_approval",
      cwd: "/tmp/project--m25",
      snapshotSha: "sha-1",
      approvalRequired: true,
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:01:00.000Z",
      completedAt: "2026-03-15T00:01:00.000Z",
    });
    await threadTurnStateRepository.upsert({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "m25",
      blockingTurnId: "turn-1",
      lastCompletedTurnId: "turn-1",
      updatedAt: "2026-03-15T00:01:00.000Z",
    });

    expect(orchestrator.isPendingApproval("chat-1", "m25")).toBe(true);

    await orchestrator.acceptTurn("chat-1", "turn-1");

    expect(orchestrator.isPendingApproval("chat-1", "m25")).toBe(false);
    await expect(turnRepository.getByTurnId("chat-1", "turn-1")).resolves.toMatchObject({ status: "accepted" });
  });

  it("stores turn summary in TurnRecord and serves history from TurnRecord", async () => {
    const turnRepository = new InMemoryTurnRepository();
    const threadTurnStateRepository = new InMemoryThreadTurnStateRepository();
    const threadRegistry = await createTestThreadRegistry();
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "53",
      threadId: "thr-53",
      backend: createBackendIdentity("codex", "gpt-5")
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: {
        createWithConfig: vi.fn(),
        get: vi.fn(() => null),
        releaseThread: vi.fn(async () => undefined),
        healthCheck: vi.fn(async () => ({ alive: true, threadCount: 0 }))
      },
      runtimeConfigProvider: makeRuntimeConfigProvider(),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry,
      turnRepository,
      threadTurnStateRepository,
    });

    await turnRepository.create({
      chatId: "chat-1",
      projectId: "chat-1",
      threadName: "53",
      threadId: "thr-53",
      turnId: "turn-53-1",
      status: "completed",
      cwd: "/tmp/project--53",
      approvalRequired: false,
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:01:00.000Z",
      completedAt: "2026-03-15T00:01:00.000Z",
      filesChanged: ["a.ts"],
    });

    await orchestrator.updateTurnSummary("chat-1", "turn-53-1", {
      lastAgentMessage: "fixed issue",
      tokenUsage: { input: 10, output: 20 },
      filesChanged: ["a.ts", "b.ts"],
    });

    await expect(turnRepository.getByTurnId("chat-1", "turn-53-1")).resolves.toMatchObject({
      lastAgentMessage: "fixed issue",
      tokenUsage: { input: 10, output: 20 },
      filesChanged: ["a.ts", "b.ts"],
    });

    await expect(orchestrator.listTurns("chat-1", 10)).resolves.toEqual([
      expect.objectContaining({
        turnId: "turn-53-1",
        threadName: "53",
        backendName: "codex",
        modelName: "gpt-5",
        filesChangedCount: 2,
        lastAgentMessage: "fixed issue",
      })
    ]);
  });

  it("supports two concurrent threads with independent pending approvals", async () => {
    const turnRepository = new InMemoryTurnRepository();
    const threadTurnStateRepository = new InMemoryThreadTurnStateRepository();
    const threadRegistry = await createTestThreadRegistry();
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "m25",
      threadId: "thr-m25",
      backend: createBackendIdentity("codex", "gpt-5")
    });
    threadRegistry.register({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "53",
      threadId: "thr-53",
      backend: createBackendIdentity("codex", "gpt-5")
    });

    const orchestrator = new ConversationOrchestrator({
      agentApiPool: {
        createWithConfig: vi.fn(),
        get: vi.fn(() => null),
        releaseThread: vi.fn(async () => undefined),
        healthCheck: vi.fn(async () => ({ alive: true, threadCount: 0 }))
      },
      runtimeConfigProvider: makeRuntimeConfigProvider(),
      userThreadBindingService: new UserThreadBindingService(),
      threadRegistry,
      turnRepository,
      threadTurnStateRepository,
    });

    await turnRepository.create({
      chatId: "chat-1",
      projectId: "chat-1",
      threadName: "m25",
      threadId: "thr-m25",
      turnId: "turn-m25-1",
      status: "awaiting_approval",
      cwd: "/tmp/project--m25",
      snapshotSha: "sha-m25",
      approvalRequired: true,
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:01:00.000Z",
      completedAt: "2026-03-15T00:01:00.000Z",
    });
    await turnRepository.create({
      chatId: "chat-1",
      projectId: "chat-1",
      threadName: "53",
      threadId: "thr-53",
      turnId: "turn-53-1",
      status: "awaiting_approval",
      cwd: "/tmp/project--53",
      snapshotSha: "sha-53",
      approvalRequired: true,
      createdAt: "2026-03-15T00:00:30.000Z",
      updatedAt: "2026-03-15T00:01:30.000Z",
      completedAt: "2026-03-15T00:01:30.000Z",
    });
    await threadTurnStateRepository.upsert({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "m25",
      blockingTurnId: "turn-m25-1",
      lastCompletedTurnId: "turn-m25-1",
      updatedAt: "2026-03-15T00:01:00.000Z",
    });
    await threadTurnStateRepository.upsert({
      projectId: "chat-1",
      chatId: "chat-1",
      threadName: "53",
      blockingTurnId: "turn-53-1",
      lastCompletedTurnId: "turn-53-1",
      updatedAt: "2026-03-15T00:01:30.000Z",
    });

    expect(orchestrator.isPendingApproval("chat-1", "m25")).toBe(true);
    expect(orchestrator.isPendingApproval("chat-1", "53")).toBe(true);

    await orchestrator.acceptTurn("chat-1", "turn-53-1");

    expect(orchestrator.isPendingApproval("chat-1", "53")).toBe(false);
    expect(orchestrator.isPendingApproval("chat-1", "m25")).toBe(true);

    await orchestrator.acceptTurn("chat-1", "turn-m25-1");

    expect(orchestrator.isPendingApproval("chat-1", "m25")).toBe(false);
  });
});
