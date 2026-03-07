import { describe, expect, it, vi } from "vitest";

import { AuthorizationError } from "../../iam/src/authorize";
import { handleInboundWebhook } from "../src/inbound-webhook";
import type { RuntimeConfigProvider } from "../src/types";
import { ConversationOrchestrator } from "../src/orchestrator";
import { ThreadBindingService } from "../src/thread-binding-service";
import { MemoryBindingRepository } from "./fixtures/memory-binding-repo";

function makeConfigProvider(): RuntimeConfigProvider {
  return {
    getProjectRuntimeConfig: vi.fn(async () => ({
      cwd: "/repos/payment",
      model: "gpt-5-codex",
      sandbox: "workspaceWrite",
      approvalPolicy: "onRequest"
    }))
  };
}

describe("inbound webhook handler", () => {
  it("returns orchestrator result on success and does not send fallback", async () => {
    const sendMessage = vi.fn(async () => "msg-1");
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu",
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
      threadStart: vi.fn(async () => ({ thread: { id: "thr-1" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: makeConfigProvider(),
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
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
        channel: "feishu",
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
      threadStart: vi.fn(async () => {
        throw new Error("codex failure");
      }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-unused" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: makeConfigProvider(),
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
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
        channel: "feishu",
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
      threadStart: vi.fn(async () => {
        throw new Error("codex failure");
      }),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-unused" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: makeConfigProvider(),
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
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

  it("propagates authorization errors before orchestrator execution", async () => {
    const adapter = {
      verifyWebhook: vi.fn(),
      parseInboundEvent: vi.fn(() => ({
        channel: "feishu",
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
    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-unused" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-unused" } }))
    };
    const orchestrator = new ConversationOrchestrator({
      codexApi,
      runtimeConfigProvider: makeConfigProvider(),
      threadBindingService: new ThreadBindingService(new MemoryBindingRepository())
    });

    await expect(
      handleInboundWebhook({
        adapter,
        orchestrator,
        projectId: "proj-1",
        role: "developer",
        headers: {},
        body: "{}",
        payload: {}
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(codexApi.threadStart).not.toHaveBeenCalled();
  });
});
