import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { routeIntent } from "../packages/channel-core/src/intent-router";
import { FeishuAdapter } from "../packages/channel-feishu/src/feishu-adapter";
import { AuthorizationError, authorizeIntent } from "../services/iam/src/index";
import { handleInboundWebhook } from "../services/orchestrator/src/inbound-webhook";
import { ConversationOrchestrator } from "../services/orchestrator/src/orchestrator";
import { ThreadBindingService } from "../services/orchestrator/src/thread-binding-service";
import { MemoryBindingRepository } from "../services/orchestrator/tests/fixtures/memory-binding-repo";

function signWebhook(body: string, timestamp: string, nonce: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}:${nonce}:${body}`).digest("hex");
}

describe("phase1 e2e minimal flow", () => {
  it("runs feishu -> router -> orchestrator -> codex -> feishu and passes traceId", async () => {
    const post = vi.fn(async () => ({
      status: 200,
      data: {
        message_id: "msg-1"
      }
    }));

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      now: () => 1000,
      httpClient: { post }
    });

    const message = adapter.parseInboundEvent({
      header: {
        event_id: "evt-1",
        create_time: "1000",
        trace_id: "trace-e2e-1"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-dev"
          }
        },
        message: {
          chat_id: "oc-proj",
          content: JSON.stringify({ text: "请修复重试逻辑" })
        }
      }
    });

    const intent = routeIntent(message);
    expect(intent.intent).toBe("TURN_START");

    expect(() => authorizeIntent("developer", intent.intent)).not.toThrow();

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

    const result = await orchestrator.handleIntent(
      "proj-1",
      message.chatId,
      intent,
      message.type === "text" ? message.text : "",
      message.traceId
    );
    expect(result).toEqual({ mode: "turn", id: "turn-1" });

    await adapter.sendMessage({
      chatId: message.chatId,
      text: "任务已启动 turn-1"
    });

    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
    expect(codexApi.turnStart).toHaveBeenCalledWith({
      threadId: "thr-1",
      traceId: "trace-e2e-1",
      input: [
        {
          type: "text",
          text: "请修复重试逻辑"
        }
      ]
    });
    expect(post).toHaveBeenCalled();
  });

  it("runs /thread new command end-to-end", async () => {
    const post = vi.fn(async () => ({
      status: 200,
      data: {
        message_id: "msg-2"
      }
    }));

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      now: () => 1000,
      httpClient: { post }
    });

    const message = adapter.parseInboundEvent({
      header: {
        event_id: "evt-thread-new",
        create_time: "1000"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-dev"
          }
        },
        message: {
          chat_id: "oc-proj",
          content: JSON.stringify({ text: "/thread new" })
        }
      }
    });

    const intent = routeIntent(message);
    expect(intent.intent).toBe("THREAD_NEW");
    expect(() => authorizeIntent("developer", intent.intent)).not.toThrow();

    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-new-1" } })),
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

    const result = await orchestrator.handleIntent("proj-1", message.chatId, intent, "");
    expect(result).toEqual({ mode: "thread", id: "thr-new-1" });

    await adapter.sendMessage({
      chatId: message.chatId,
      text: "线程已重建 thr-new-1"
    });

    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
    expect(codexApi.turnStart).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalled();
  });

  it("sends fallback error message when codex threadStart fails", async () => {
    const post = vi.fn(async () => ({
      status: 200,
      data: { message_id: "msg-error" }
    }));

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      now: () => 1000,
      httpClient: { post }
    });

    const payload = {
      header: {
        event_id: "evt-error",
        create_time: "1000"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-dev"
          }
        },
        message: {
          chat_id: "oc-proj",
          content: JSON.stringify({ text: "故障演练" })
        }
      }
    };
    const body = JSON.stringify(payload);
    const headers = {
      "x-feishu-timestamp": "1000",
      "x-feishu-nonce": "nonce-e2e-error",
      "x-feishu-signature": signWebhook(body, "1000", "nonce-e2e-error", "sig")
    };

    const codexApi = {
      threadStart: vi.fn(async () => {
        throw new Error("codex down");
      }),
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

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers,
      body,
      payload
    });

    expect(result.ok).toBe(false);
    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][1]).toMatchObject({
      receive_id: "oc-proj",
      msg_type: "text"
    });
    expect(String((post.mock.calls[0][1] as { content: string }).content)).toContain("系统繁忙");
  });

  it("blocks /project create from developer role in e2e flow", async () => {
    const post = vi.fn(async () => ({
      status: 200,
      data: { message_id: "msg-noop" }
    }));
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      now: () => 1000,
      httpClient: { post }
    });

    const payload = {
      header: {
        event_id: "evt-deny",
        create_time: "1000"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-dev"
          }
        },
        message: {
          chat_id: "oc-proj",
          content: JSON.stringify({ text: "/project create --name blocked" })
        }
      }
    };
    const body = JSON.stringify(payload);
    const headers = {
      "x-feishu-timestamp": "1000",
      "x-feishu-nonce": "nonce-e2e-deny",
      "x-feishu-signature": signWebhook(body, "1000", "nonce-e2e-deny", "sig")
    };

    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-should-not-run" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-should-not-run" } }))
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

    await expect(
      handleInboundWebhook({
        adapter,
        orchestrator,
        projectId: "proj-1",
        role: "developer",
        headers,
        body,
        payload
      })
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(codexApi.threadStart).not.toHaveBeenCalled();
    expect(codexApi.turnStart).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("verifies webhook signature before routing in e2e flow", async () => {
    const post = vi.fn(async () => ({
      status: 200,
      data: { message_id: "msg-sign-ok" }
    }));
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      now: () => 1000,
      httpClient: { post }
    });

    const payload = {
      header: {
        event_id: "evt-sign-ok",
        create_time: "1000",
        trace_id: "trace-sign-ok"
      },
      event: {
        sender: {
          sender_id: {
            open_id: "ou-dev"
          }
        },
        message: {
          chat_id: "oc-proj",
          content: JSON.stringify({ text: "hello from signed webhook" })
        }
      }
    };
    const body = JSON.stringify(payload);
    const headers = {
      "x-feishu-timestamp": "1000",
      "x-feishu-nonce": "nonce-e2e-sign-ok",
      "x-feishu-signature": signWebhook(body, "1000", "nonce-e2e-sign-ok", "sig")
    };

    const codexApi = {
      threadStart: vi.fn(async () => ({ thread: { id: "thr-sign-ok" } })),
      turnStart: vi.fn(async () => ({ turn: { id: "turn-sign-ok" } }))
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

    const result = await handleInboundWebhook({
      adapter,
      orchestrator,
      projectId: "proj-1",
      role: "developer",
      headers,
      body,
      payload
    });

    expect(result.ok).toBe(true);
    expect(codexApi.threadStart).toHaveBeenCalledTimes(1);
    expect(codexApi.turnStart).toHaveBeenCalledTimes(1);
  });
});
