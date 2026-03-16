import { describe, expect, it, vi } from "vitest";

import { handleInboundWebhook } from "../../src/index";
import type { RuntimeConfigProvider } from "../../src/contracts";
import { ConversationOrchestrator, UserThreadBindingService } from "../../src/index";
import { createBackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import { createTestThreadRegistry } from "../helpers/test-thread-registry";

function makeConfigProvider(): RuntimeConfigProvider {
  return {
    getProjectRuntimeConfig: vi.fn(async () => ({
      cwd: "/repos/payment",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      sandbox: "workspace-write",
      approvalPolicy: "onRequest"
    }))
  };
}

function makePoolFrom(codexApi: unknown) {
  return {
    createWithConfig: vi.fn(async () => codexApi as never),
    get: vi.fn(() => null),
    releaseThread: vi.fn(async () => undefined),
    releaseAll: vi.fn(async () => undefined),
    healthCheck: vi.fn(async () => ({ alive: true, threadCount: 0 }))
  };
}

describe("inbound webhook handler", () => {
  it("returns orchestrator result on success and does not send fallback", async () => {
    const sendMessage = vi.fn(async () => "msg-1");
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-1",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "text" as const,
        text: "hello",
        mentions: []
      })),
      sendMessage
    };
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
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
      userId: "ou-dev",
      threadName: "fix-retry",
      threadId: "thr-1",
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeConfigProvider(),
      userThreadBindingService,
      threadRegistry
    });

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {}
    });

    expect(result).toEqual({ ok: true, result: { mode: "turn", id: "turn-1" } });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends fallback when orchestrator fails", async () => {
    const sendMessage = vi.fn(async () => "msg-error");
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-2",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "text" as const,
        text: "hello",
        mentions: []
      })),
      sendMessage
    };
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => {
        throw new Error("codex failure");
      })
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
      userId: "ou-dev",
      threadName: "fix-retry",
      threadId: "thr-1",
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeConfigProvider(),
      userThreadBindingService,
      threadRegistry
    });

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {}
    });

    expect(result.ok).toBe(false);
    expect(sendMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      text: "系统繁忙，请稍后重试"
    });
  });

  it("uses custom error message when provided", async () => {
    const sendMessage = vi.fn(async () => "msg-custom");
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-3",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "text" as const,
        text: "hello",
        mentions: []
      })),
      sendMessage
    };
    const codexApi = {
      backendType: "codex" as const,
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => {
        throw new Error("codex failure");
      })
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
      userId: "ou-dev",
      threadName: "fix-retry",
      threadId: "thr-1",
    });
    const orchestrator = new ConversationOrchestrator({
      agentApiPool: makePoolFrom(codexApi),
      runtimeConfigProvider: makeConfigProvider(),
      userThreadBindingService,
      threadRegistry
    });

    await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {},
      errorMessage: "请求失败"
    });

    expect(sendMessage).toHaveBeenCalledWith({
      chatId: "chat-1",
      text: "请求失败"
    });
  });

  it("treats command payloads as TURN_START and does not raise legacy command auth errors", async () => {
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu" as const,
        eventId: "evt-4",
        chatId: "chat-1",
        userId: "ou-dev",
        timestamp: 1,
        raw: {},
        type: "command" as const,
        text: "/project create --name deny",
        command: "/project",
        args: ["create", "--name", "deny"]
      })),
      sendMessage: vi.fn(async () => "msg-noop")
    };
    const orchestrator = {
      handleIntent: vi.fn(async () => ({ mode: "turn" as const, id: "turn-legacy-command" }))
    };

    await expect(handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers: {},
      body: "{}",
      payload: {}
    })).resolves.toEqual({
      ok: true,
      result: { mode: "turn", id: "turn-legacy-command" }
    });
    expect(orchestrator.handleIntent).toHaveBeenCalled();
  });
});
