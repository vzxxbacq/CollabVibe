import { describe, expect, it, vi } from "vitest";

import { ChannelError } from "../../channel-core/src/errors";
import { FeishuAdapter } from "../src/feishu-adapter";
import type { HttpClient } from "../src/http-client";

describe("feishu send api", () => {
  it("sends text/card/update request payloads", async () => {
    const post = vi.fn(async () => ({
      status: 200,
      data: {
        message_id: "msg-1"
      }
    }));

    const httpClient: HttpClient = {
      post
    };

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient
    });

    await expect(adapter.sendMessage({ chatId: "oc-1", text: "hello" })).resolves.toBe("msg-1");
    await expect(adapter.sendInteractiveCard("oc-1", { title: "审批" })).resolves.toBe("msg-1");
    await expect(adapter.updateInteractiveCard("card-token", { title: "更新" })).resolves.toBeUndefined();

    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[0][0]).toContain("im/v1/messages?receive_id_type=chat_id");
    expect(post.mock.calls[1][0]).toContain("im/v1/messages?receive_id_type=chat_id");
  });

  it("retries once and fails with channel error", async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, data: {} })
      .mockResolvedValueOnce({ status: 500, data: {} });

    const httpClient: HttpClient = {
      post
    };

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
      .mockResolvedValueOnce({ status: 200, data: { message_id: "msg-retry-ok" } });

    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig",
      httpClient: { post }
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
        post: vi.fn(async () => ({ status: 200, data: {} }))
      }
    });

    await expect(adapter.resolveUserIdentity("ou-1")).resolves.toEqual({
      externalUserId: "ou-1",
      displayName: "ou-1"
    });
  });
});
