import { beforeEach, describe, expect, it } from "vitest";

import { CodexClient } from "../../../src/codex-client";
import { JsonRpcClient } from "../../../src/rpc-client";
import type { JsonRpcRequest, JsonRpcResponse, RpcTransport } from "../../../src/types";

class ApprovalTransport implements RpcTransport {
  readonly requests: JsonRpcRequest[] = [];

  async request<T = unknown>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    this.requests.push(request);
    if (request.method === "initialize") {
      return { id: request.id, result: {} as T };
    }
    return { id: request.id, result: {} as T };
  }

  async notify(): Promise<void> {
    return;
  }
}

describe("approval-response", () => {
  let transport: ApprovalTransport;
  let client: CodexClient;

  beforeEach(async () => {
    transport = new ApprovalTransport();
    client = new CodexClient(new JsonRpcClient(transport));
    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.2.0"
      }
    });
  });

  it("sends explicit command approval accept/decline payloads", async () => {
    await client.respondExecApproval({
      requestId: "appr-1",
      threadId: "thr-1",
      turnId: "turn-1",
      callId: "call-1",
      decision: "accept"
    });
    await client.respondExecApproval({
      requestId: "appr-2",
      threadId: "thr-1",
      turnId: "turn-2",
      callId: "call-2",
      decision: "decline"
    });

    expect(transport.requests[1]).toEqual({
      id: "rpc-2",
      method: "execCommandApproval/respond",
      params: {
        requestId: "appr-1",
        conversationId: "thr-1",
        turnId: "turn-1",
        callId: "call-1",
        response: { decision: "approved" }
      }
    });
    expect(transport.requests[2].params?.response).toEqual({ decision: "denied" });
  });

  it("sends explicit file-change approval payload", async () => {
    await client.respondApplyPatchApproval({
      requestId: "appr-3",
      threadId: "thr-2",
      turnId: "turn-3",
      callId: "call-3",
      decision: "approve_always"
    });

    expect(transport.requests[1]).toEqual({
      id: "rpc-2",
      method: "applyPatchApproval/respond",
      params: {
        requestId: "appr-3",
        conversationId: "thr-2",
        turnId: "turn-3",
        callId: "call-3",
        response: { decision: "approved_for_session" }
      }
    });
  });

  it("rejects invalid decision values", async () => {
    await expect(
      client.respondExecApproval({
        requestId: "appr-4",
        threadId: "thr-2",
        turnId: "turn-4",
        callId: "call-4",
        decision: "approve" as "accept"
      })
    ).rejects.toThrowError("invalid approval decision");
  });
});
