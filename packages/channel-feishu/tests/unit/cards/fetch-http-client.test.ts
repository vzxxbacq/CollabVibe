import { describe, expect, it, vi } from "vitest";

import { FetchHttpClient, FeishuHttpError } from "../../../src/fetch-http-client";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

describe("fetch-http-client", () => {
  it("auto-fetches tenant token before first request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: "tenant-1", expire: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { ok: true } }));
    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher
    });

    const response = await client.post<{ data: { ok: boolean } }>("https://open.feishu.cn/open-apis/im/v1/messages", {
      receive_id: "chat_1"
    });

    expect(response.status).toBe(200);
    expect(response.data).toMatchObject({ data: { ok: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer tenant-1"
      })
    });
  });

  it("refreshes token when expiry window is reached", async () => {
    let now = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: "tenant-1", expire: 61 }))
      .mockResolvedValueOnce(jsonResponse({ code: 0 }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: "tenant-2", expire: 61 }))
      .mockResolvedValueOnce(jsonResponse({ code: 0 }));

    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher,
      now: () => now
    });

    await client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 1 });
    now = 2_000;
    await client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 2 });

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer tenant-2"
      })
    });
  });

  it("throws parsed feishu error for non-2xx or non-zero code", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: "tenant-1", expire: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ code: 999, msg: "rate limit" }, 429));

    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher
    });

    const expected: Partial<FeishuHttpError> = {
      name: "FeishuHttpError",
      status: 429,
      code: 999
    };
    await expect(client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 1 })).rejects.toMatchObject(expected);
  });

  it("[C4-4] reuses token when not expired", async () => {
    let now = 0;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: "tenant-1", expire: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { ok: 1 } }))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: { ok: 2 } }));
    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher,
      now: () => now
    });

    await client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 1 });
    now = 1_000;
    await client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 2 });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer tenant-1" })
    });
  });

  it("[C4-6] throws FeishuHttpError when HTTP 200 contains non-zero business code", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 0, tenant_access_token: "tenant-1", expire: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ code: 999, msg: "rate limit" }, 200));
    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher
    });

    const expected: Partial<FeishuHttpError> = {
      name: "FeishuHttpError",
      status: 200,
      code: 999
    };
    await expect(client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 1 })).rejects.toMatchObject(expected);
  });

  it("[C4-7] throws FeishuHttpError when tenant token request fails", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(jsonResponse({ code: 91401, msg: "auth failed" }, 401));
    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher
    });

    const expected: Partial<FeishuHttpError> = {
      name: "FeishuHttpError",
      status: 401,
      code: 91401
    };
    await expect(client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 1 })).rejects.toMatchObject(expected);
  });

  it("[C4-8] deduplicates concurrent token refresh calls", async () => {
    let tokenResolver: ((response: Response) => void) | null = null;
    const tokenPromise = new Promise<Response>((resolve) => {
      tokenResolver = resolve;
    });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (typeof url === "string" && url.includes("tenant_access_token")) {
        return tokenPromise;
      }
      return jsonResponse({ code: 0, data: { ok: true } });
    });
    const client = new FetchHttpClient({
      appId: "cli_1",
      appSecret: "sec_1",
      fetcher
    });

    const req1 = client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 1 });
    const req2 = client.post("https://open.feishu.cn/open-apis/im/v1/messages", { a: 2 });
    if (!tokenResolver) {
      throw new Error("tokenResolver not initialized");
    }
    const resolveToken: (response: Response) => void = tokenResolver;
    resolveToken(jsonResponse({ code: 0, tenant_access_token: "tenant-1", expire: 3600 }));

    await Promise.all([req1, req2]);

    const tokenCalls = fetcher.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("tenant_access_token")
    );
    expect(tokenCalls).toHaveLength(1);
  });
});
