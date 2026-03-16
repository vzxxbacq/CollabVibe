import { describe, expect, it, vi } from "vitest";

import { ChannelError } from "../../../channel-core/src/errors";
import { FeishuAdapter } from "../../src/feishu-adapter";
import type { HttpClient } from "../../src/http-client";

describe("feishu send api", () => {
  it("sends text/card/update request payloads", async () => {
    const post = vi.fn(async (_url: string, _body: unknown) => ({
      status: 200,
      data: {
        data: { message_id: "msg-1" }
      }
    }));
    const patch = vi.fn(async (_url: string, _body: unknown) => ({ status: 200, data: {} }));

    const httpClient = { post, patch } as unknown as HttpClient;

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient
    });

    await expect(adapter.sendMessage({ chatId: "oc-1", text: "hello" })).resolves.toBe("msg-1");
    await expect(adapter.sendInteractiveCard("oc-1", { title: "审批" })).resolves.toBe("msg-1");
    await expect(adapter.updateInteractiveCard("card-token", { title: "更新" })).resolves.toBeUndefined();

    expect(post).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]![0]).toContain("im/v1/messages?receive_id_type=chat_id");
    expect(post.mock.calls[1]![0]).toContain("im/v1/messages?receive_id_type=chat_id");
    expect(patch.mock.calls[0]![0]).toContain("im/v1/messages/card-token");
  });

  it("retries once and fails with channel error", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, data: {} })
      .mockResolvedValueOnce({ status: 500, data: {} });
    const patch = vi.fn(async (_url: string, _body: unknown) => ({ status: 200, data: {} }));

    const httpClient = { post, patch } as unknown as HttpClient;

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient
    });

    await expect(adapter.sendMessage({ chatId: "oc-1", text: "hello" })).rejects.toBeInstanceOf(ChannelError);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retries once and succeeds on second attempt", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, data: {} })
      .mockResolvedValueOnce({ status: 200, data: { data: { message_id: "msg-retry-ok" } } });
    const patch = vi.fn();

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient: { post, patch } as unknown as HttpClient
    });

    await expect(adapter.sendMessage({ chatId: "oc-1", text: "hello" })).resolves.toBe("msg-retry-ok");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("resolves user identity without throwing", async () => {
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient: {
        get: vi.fn(async (_url: string) => ({ status: 200, data: {} })),
        post: vi.fn(async (_url: string, _body: unknown) => ({ status: 200, data: {} })),
        patch: vi.fn(async (_url: string, _body: unknown) => ({ status: 200, data: {} })),
        delete: vi.fn(async (_url: string) => ({ status: 200, data: {} }))
      } as unknown as HttpClient
    });

    await expect(adapter.resolveUserIdentity("ou-1")).resolves.toEqual({
      externalUserId: "ou-1",
      displayName: "ou-1"
    });
  });

  it("downloads a message file to local path", async () => {
    const getBinary = vi.fn(async () => ({
      status: 200,
      data: new Uint8Array([1, 2, 3]),
      headers: { "content-disposition": `attachment; filename="skill.tgz"` }
    }));
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient: {
        get: vi.fn(async () => ({ status: 200, data: {} })),
        getBinary,
        post: vi.fn(async () => ({ status: 200, data: {} })),
        patch: vi.fn(async () => ({ status: 200, data: {} })),
        delete: vi.fn(async () => ({ status: 200, data: {} })),
      } as unknown as HttpClient
    });

    const result = await adapter.downloadMessageFile({
      messageId: "om_1",
      fileKey: "file_1",
      targetDir: "/tmp",
    });

    expect(getBinary).toHaveBeenCalledWith(
      expect.stringContaining("/im/v1/messages/om_1/resources/file_1?type=file"),
      expect.any(Object)
    );
    expect(result.originalName).toBe("skill.tgz");
    expect(result.localPath).toContain("/tmp/");
  });
});
