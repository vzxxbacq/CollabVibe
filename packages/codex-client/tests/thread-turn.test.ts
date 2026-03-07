import { beforeEach, describe, expect, it } from "vitest";

import { CodexClient } from "../src/codex-client";
import { JsonRpcClient } from "../src/rpc-client";
import type { JsonRpcRequest, JsonRpcResponse, RpcTransport } from "../src/types";

class MethodTransport implements RpcTransport {
  readonly requests: JsonRpcRequest[] = [];

  async request<T = unknown>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    if (request.method === "thread/start") {
      return {
        id: request.id,
        result: {
          thread: {
            id: "thr-1",
            preview: "Fix retry logic",
            ephemeral: false,
            modelProvider: "openai",
            createdAt: 1741305600
          }
        } as T
      };
    }
    if (request.method === "thread/resume") {
      const threadId = request.params?.threadId;
      if (threadId === "thr-404") {
        return {
          id: request.id,
          error: {
            code: -32001,
            message: "thread not found"
          }
        };
      }
      return {
        id: request.id,
        result: {
          thread: {
            id: "thr-1",
            name: "Payment hotfix",
            ephemeral: false
          }
        } as T
      };
    }
    if (request.method === "thread/fork") {
      return {
        id: request.id,
        result: {
          thread: {
            id: "thr-fork-1",
            name: "Payment hotfix (fork)",
            ephemeral: true
          }
        } as T
      };
    }
    if (request.method === "turn/start") {
      return {
        id: request.id,
        result: {
          turn: {
            id: "turn-1",
            status: "inProgress",
            items: [],
            error: null
          }
        } as T
      };
    }
    if (request.method === "turn/interrupt") {
      return {
        id: request.id,
        result: {} as T
      };
    }
    return { id: request.id, result: {} as T };
  }

  async notify(): Promise<void> {
    return;
  }
}

describe("thread/turn api", () => {
  let transport: MethodTransport;
  let client: CodexClient;

  beforeEach(async () => {
    transport = new MethodTransport();
    const rpc = new JsonRpcClient(transport);
    client = new CodexClient(rpc);

    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.1.0"
      }
    });
  });

  it("uses official thread/turn result shapes and array input", async () => {
    await expect(
      client.threadStart({
        cwd: "/repos/payment",
        model: "gpt-5-codex",
        sandbox: "workspaceWrite",
        approvalPolicy: "onRequest"
      })
    ).resolves.toEqual({
      thread: {
        id: "thr-1",
        preview: "Fix retry logic",
        ephemeral: false,
        modelProvider: "openai",
        createdAt: 1741305600
      }
    });

    await expect(
      client.turnStart({
        threadId: "thr-1",
        input: [
          {
            type: "text",
            text: "fix retry"
          }
        ]
      })
    ).resolves.toEqual({
      turn: {
        id: "turn-1",
        status: "inProgress",
        items: [],
        error: null
      }
    });

    const turnStartRequest = transport.requests[2];
    expect(turnStartRequest.method).toBe("turn/start");
    expect(turnStartRequest.params?.input).toEqual([{ type: "text", text: "fix retry" }]);
  });

  it("sends threadId and turnId for turn/interrupt", async () => {
    await expect(client.turnInterrupt("thr-1", "turn-1")).resolves.toBeUndefined();

    const interruptRequest = transport.requests[1];
    expect(interruptRequest.method).toBe("turn/interrupt");
    expect(interruptRequest.params).toEqual({ threadId: "thr-1", turnId: "turn-1" });
  });

  it("supports thread/resume result shape", async () => {
    await expect(client.threadResume("thr-1")).resolves.toEqual({
      thread: {
        id: "thr-1",
        name: "Payment hotfix",
        ephemeral: false
      }
    });
  });

  it("surfaces thread/resume errors", async () => {
    await expect(client.threadResume("thr-404")).rejects.toThrowError("thread not found");
  });

  it("supports thread/fork", async () => {
    await expect(client.threadFork("thr-1")).resolves.toEqual({
      thread: {
        id: "thr-fork-1",
        name: "Payment hotfix (fork)",
        ephemeral: true
      }
    });
  });
});
