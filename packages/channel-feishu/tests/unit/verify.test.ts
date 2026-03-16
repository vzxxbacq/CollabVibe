import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { ChannelError } from "../../../channel-core/src/errors";
import { FeishuAdapter } from "../../src/feishu-adapter";
import { noopHttpClient } from "../fixtures/noop-http-client";

function sign(body: string, timestamp: string, nonce: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}:${nonce}:${body}`).digest("hex");
}

describe("feishu verify webhook", () => {
  it("rejects when signature headers are all missing", () => {
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig-secret",
      httpClient: noopHttpClient,
      now: () => 1000
    });

    expect(() => adapter.verifyWebhook({}, "{}")).toThrowError("missing feishu signature headers");
  });

  it("accepts valid signatures", () => {
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig-secret",
      httpClient: noopHttpClient,
      now: () => 1000
    });

    const timestamp = "1000";
    const nonce = "nonce";
    const body = "{}";
    const signature = sign(body, timestamp, nonce, "sig-secret");

    expect(() =>
      adapter.verifyWebhook(
        {
          "x-feishu-timestamp": timestamp,
          "x-feishu-nonce": nonce,
          "x-feishu-signature": signature,
          "x-feishu-event-id": "evt-ok"
        },
        body
      )
    ).not.toThrow();
  });

  it("rejects invalid signatures", () => {
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig-secret",
      httpClient: noopHttpClient,
      now: () => 1000
    });

    expect(() =>
      adapter.verifyWebhook(
        {
          "x-feishu-timestamp": "1000",
          "x-feishu-nonce": "nonce",
          "x-feishu-signature": "bad-signature"
        },
        "{}"
      )
    ).toThrowError(ChannelError);
  });

  it("rejects expired timestamps", () => {
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig-secret",
      httpClient: noopHttpClient,
      now: () => 1000,
      maxClockSkewSec: 10
    });

    const timestamp = "970";
    const nonce = "nonce";
    const body = "{}";

    expect(() =>
      adapter.verifyWebhook(
        {
          "x-feishu-timestamp": timestamp,
          "x-feishu-nonce": nonce,
          "x-feishu-signature": sign(body, timestamp, nonce, "sig-secret")
        },
        body
      )
    ).toThrowError("feishu event timestamp is outside allowed window");
  });

  it("rejects replayed event id", () => {
    const adapter = new FeishuAdapter({
      appId: "id",
      appSecret: "secret",
      signingSecret: "sig-secret",
      httpClient: noopHttpClient,
      now: () => 1000
    });

    const timestamp = "1000";
    const nonce = "nonce";
    const body = "{}";
    const signature = sign(body, timestamp, nonce, "sig-secret");

    adapter.verifyWebhook(
      {
        "x-feishu-timestamp": timestamp,
        "x-feishu-nonce": nonce,
        "x-feishu-signature": signature,
        "x-feishu-event-id": "evt-1"
      },
      body
    );

    expect(() =>
      adapter.verifyWebhook(
        {
          "x-feishu-timestamp": timestamp,
          "x-feishu-nonce": nonce,
          "x-feishu-signature": signature,
          "x-feishu-event-id": "evt-1"
        },
        body
      )
    ).toThrowError("feishu event replayed");
  });
});
