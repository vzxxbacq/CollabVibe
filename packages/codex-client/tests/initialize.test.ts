import { describe, expect, it, vi } from "vitest";

import { CodexClientStateError } from "../src/errors";
import { JsonRpcClient } from "../src/rpc-client";
import type { JsonRpcRequest, JsonRpcResponse, RpcTransport } from "../src/types";

class InitTransport implements RpcTransport {
  readonly notify = vi.fn(async () => undefined);

  async request<T = unknown>(request: JsonRpcRequest): Promise<JsonRpcResponse<T>> {
    return {
      id: request.id,
      result: {} as T
    };
  }
}

describe("initialize flow", () => {
  it("rejects calling methods before initialize", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await expect(client.call("thread/start", {})).rejects.toBeInstanceOf(CodexClientStateError);
  });

  it("requires clientInfo name/title/version", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await expect(
      client.initialize({
        // Type cast simulates malformed runtime payload from non-TS caller.
        clientInfo: { name: "codex-im" } as unknown as { name: string; title: string; version: string }
      })
    ).rejects.toThrowError("initialize requires clientInfo.name/title/version and valid optional capabilities");
  });

  it("sends initialize then initialized", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.1.0"
      }
    });

    expect(client.isInitialized()).toBe(true);
    expect(transport.notify).toHaveBeenCalledWith("initialized", {});
  });

  it("rejects initialize when client is already initialized", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await client.initialize({
      clientInfo: {
        name: "codex-im",
        title: "Codex IM",
        version: "0.1.0"
      }
    });

    await expect(
      client.initialize({
        clientInfo: {
          name: "codex-im",
          title: "Codex IM",
          version: "0.1.0"
        }
      })
    ).rejects.toThrowError("already initialized");
  });

  it("rejects initialize when capabilities.experimentalApi is not boolean", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await expect(
      client.initialize({
        clientInfo: {
          name: "codex-im",
          title: "Codex IM",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: "yes"
        } as unknown as { experimentalApi: boolean }
      })
    ).rejects.toThrowError("initialize requires clientInfo.name/title/version and valid optional capabilities");
  });

  it("rejects initialize when capabilities.optOutNotificationMethods contains non-string values", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await expect(
      client.initialize({
        clientInfo: {
          name: "codex-im",
          title: "Codex IM",
          version: "0.1.0"
        },
        capabilities: {
          optOutNotificationMethods: [123]
        } as unknown as { optOutNotificationMethods: string[] }
      })
    ).rejects.toThrowError("initialize requires clientInfo.name/title/version and valid optional capabilities");
  });

  it("accepts initialize when capabilities are valid", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await expect(
      client.initialize({
        clientInfo: {
          name: "codex-im",
          title: "Codex IM",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: ["foo"]
        }
      })
    ).resolves.toBeUndefined();
  });

  it("accepts initialize when capabilities is an empty object", async () => {
    const transport = new InitTransport();
    const client = new JsonRpcClient(transport);

    await expect(
      client.initialize({
        clientInfo: {
          name: "codex-im",
          title: "Codex IM",
          version: "0.1.0"
        },
        capabilities: {}
      })
    ).resolves.toBeUndefined();
  });
});
