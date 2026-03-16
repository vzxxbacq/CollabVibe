import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodexClient } from "../../../src/codex-client";
import { JsonRpcClient } from "../../../src/rpc-client";
import type { JsonRpcRequest, JsonRpcResponse, RpcTransport } from "../../../src/types";

class InterruptTransport implements RpcTransport {
  readonly requests: JsonRpcRequest[] = [];

  async request<T = unknown>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    if (request.method === "initialize") {
      return { id: request.id, result: {} as T };
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
    return { id: request.id, result: {} as T };
  }

  async notify(): Promise<void> {
    return;
  }
}

describe("interrupt-recovery", () => {
  let transport: InterruptTransport;
  let client: CodexClient;

  beforeEach(async () => {
    transport = new InterruptTransport();
    client = new CodexClient(new JsonRpcClient(transport));
    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.2.0"
      }
    });
  });

  it("tracks inProgress to interrupted status updates", async () => {
    const listener = vi.fn();
    client.onTurnStatusUpdate(listener);

    await client.turnStart({
      threadId: "thr-1",
      input: [{ type: "text", text: "run" }]
    });
    await client.turnInterrupt("thr-1", "turn-1");

    expect(client.getTurnStatus("turn-1")).toEqual({
      threadId: "thr-1",
      turnId: "turn-1",
      status: "interrupted"
    });
    expect(listener).toHaveBeenCalledWith({
      threadId: "thr-1",
      turnId: "turn-1",
      status: "inProgress"
    });
    expect(listener).toHaveBeenCalledWith({
      threadId: "thr-1",
      turnId: "turn-1",
      status: "interrupted"
    });
  });

  it("builds approval request index from tracked turn context", async () => {
    await client.turnStart({
      threadId: "thr-1",
      input: [{ type: "text", text: "run" }]
    });

    client.trackApprovalRequest({
      type: "command_exec",
      requestId: "appr-1",
      callId: "call-1",
      turnId: "turn-1",
      description: "approval"
    });

    expect(client.getApprovalContext("appr-1")).toEqual({
      type: "command_exec",
      threadId: "thr-1",
      turnId: "turn-1",
      callId: "call-1"
    });
  });
});
