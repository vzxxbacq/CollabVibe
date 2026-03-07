import { describe, expect, it } from "vitest";

import { CodexApiError } from "../src/errors";
import { JsonRpcClient } from "../src/rpc-client";
import type { JsonRpcRequest, JsonRpcResponse, RpcTransport } from "../src/types";

class MemoryTransport implements RpcTransport {
  readonly requests: Array<{ request: JsonRpcRequest; timeoutMs?: number }> = [];

  async request<T = unknown>(request: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse<T>> {
    this.requests.push({ request, timeoutMs });
    return {
      id: request.id,
      result: { ok: true } as T
    };
  }

  async notify(): Promise<void> {
    return;
  }
}

describe("json-rpc transport", () => {
  it("generates incremental request ids", () => {
    const client = new JsonRpcClient(new MemoryTransport());
    expect(client.nextRequestId()).toBe("rpc-1");
    expect(client.nextRequestId()).toBe("rpc-2");
  });

  it("passes timeout to transport", async () => {
    const transport = new MemoryTransport();
    const client = new JsonRpcClient(transport);
    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.1.0"
      }
    });
    await client.call("thread/list", {}, 3210);

    const last = transport.requests.at(-1);
    expect(last).toBeDefined();
    if (!last) {
      return;
    }
    expect(last.request.method).toBe("thread/list");
    expect(last.timeoutMs).toBe(3210);
  });

  it("throws CodexApiError when call response contains rpc error", async () => {
    class ErrorTransport extends MemoryTransport {
      override async request<T = unknown>(request: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse<T>> {
        this.requests.push({ request, timeoutMs });
        if (request.method === "thread/list") {
          return {
            id: request.id,
            error: {
              code: -32001,
              message: "not found"
            }
          };
        }
        return {
          id: request.id,
          result: {} as T
        };
      }
    }

    const transport = new ErrorTransport();
    const client = new JsonRpcClient(transport);

    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.1.0"
      }
    });

    const error = await client.call("thread/list", {}).catch((value) => value as Error);

    expect(error).toBeInstanceOf(CodexApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CodexApiError");
    expect(error.message).toBe("not found");
    expect((error as CodexApiError).code).toBe(-32001);
  });

  it("rejects when server returns empty result payload", async () => {
    class UndefinedResultTransport extends MemoryTransport {
      override async request<T = unknown>(request: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse<T>> {
        this.requests.push({ request, timeoutMs });
        if (request.method === "test") {
          return {
            id: request.id,
            result: undefined
          };
        }

        return {
          id: request.id,
          result: {} as T
        };
      }
    }

    const transport = new UndefinedResultTransport();
    const client = new JsonRpcClient(transport);

    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.1.0"
      }
    });

    const error = await client.call<{ ok: boolean }>("test", {}).catch((value) => value as Error);

    expect(error).toBeInstanceOf(CodexApiError);
    expect(error.message).toBe("server returned empty result");
    expect((error as CodexApiError).code).toBe(-32000);
  });
});
