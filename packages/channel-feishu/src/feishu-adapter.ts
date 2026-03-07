import crypto from "node:crypto";

import {
  BaseChannelAdapter,
  ChannelError,
  assertUnifiedMessage,
  type UnifiedMessage,
  type UnifiedResponse
} from "../../channel-core/src/index";

import type { HttpClient } from "./http-client";
import { ReplayCache } from "./replay-cache";

interface FeishuAdapterOptions {
  appId: string;
  appSecret: string;
  signingSecret: string;
  apiBaseUrl?: string;
  now?: () => number;
  maxClockSkewSec?: number;
  replayCache?: ReplayCache;
  httpClient: HttpClient;
}

function parseTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text ?? "";
  } catch {
    return "";
  }
}

export class FeishuAdapter extends BaseChannelAdapter {
  private readonly signingSecret: string;

  private readonly apiBaseUrl: string;

  private readonly now: () => number;

  private readonly maxClockSkewSec: number;

  private readonly replayCache: ReplayCache;

  private readonly httpClient: HttpClient;

  constructor(options: FeishuAdapterOptions) {
    super();
    this.signingSecret = options.signingSecret;
    this.apiBaseUrl = options.apiBaseUrl ?? "https://open.feishu.cn/open-apis";
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    this.maxClockSkewSec = options.maxClockSkewSec ?? 300;
    this.replayCache = options.replayCache ?? new ReplayCache();
    this.httpClient = options.httpClient;
  }

  verifyWebhook(headers: Record<string, string>, body: string): void {
    const timestamp = headers["x-feishu-timestamp"];
    const nonce = headers["x-feishu-nonce"];
    const signature = headers["x-feishu-signature"];

    if (!timestamp || !nonce || !signature) {
      throw new ChannelError("CHANNEL_INVALID_SIGNATURE", "missing feishu signature headers");
    }

    const now = this.now();
    const ts = Number(timestamp);
    if (Number.isNaN(ts) || Math.abs(now - ts) > this.maxClockSkewSec) {
      throw new ChannelError("CHANNEL_EVENT_EXPIRED", "feishu event timestamp is outside allowed window");
    }

    const expectedSignature = crypto
      .createHmac("sha256", this.signingSecret)
      .update(`${timestamp}:${nonce}:${body}`)
      .digest("hex");

    if (expectedSignature !== signature) {
      throw new ChannelError("CHANNEL_INVALID_SIGNATURE", "feishu signature mismatch");
    }

    const eventId = headers["x-feishu-event-id"];
    if (eventId) {
      if (this.replayCache.has(eventId)) {
        throw new ChannelError("CHANNEL_EVENT_REPLAYED", "feishu event replayed");
      }
      this.replayCache.remember(eventId);
    }
  }

  parseInboundEvent(payload: unknown): UnifiedMessage {
    const event = payload as Record<string, any>;

    if (event.type === "card.action") {
      const value = (event.event?.action?.value ?? {}) as Record<string, string>;
      const action = String(event.event?.action?.name ?? "card_action");
      return assertUnifiedMessage({
        channel: "feishu",
        eventId: String(event.header?.event_id ?? ""),
        traceId: event.header?.trace_id ? String(event.header.trace_id) : undefined,
        chatId: String(event.event?.context?.open_chat_id ?? ""),
        userId: String(event.event?.operator?.operator_id?.open_id ?? ""),
        timestamp: Number(event.header?.create_time ?? this.now()),
        raw: payload,
        type: "card_action",
        action,
        value
      });
    }

    const text = parseTextContent(String(event.event?.message?.content ?? "{}"));
    const mentions = Array.isArray(event.event?.message?.mentions)
      ? event.event.message.mentions
          .map((mention: any) => mention?.id?.open_id)
          .filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (text.startsWith("/")) {
      const tokens = text.trim().split(/\s+/g);
      return assertUnifiedMessage({
        channel: "feishu",
        eventId: String(event.header?.event_id ?? ""),
        traceId: event.header?.trace_id ? String(event.header.trace_id) : undefined,
        chatId: String(event.event?.message?.chat_id ?? ""),
        userId: String(event.event?.sender?.sender_id?.open_id ?? ""),
        timestamp: Number(event.header?.create_time ?? this.now()),
        raw: payload,
        type: "command",
        text,
        command: tokens[0] ?? "",
        args: tokens.slice(1)
      });
    }

    return assertUnifiedMessage({
      channel: "feishu",
      eventId: String(event.header?.event_id ?? ""),
      traceId: event.header?.trace_id ? String(event.header.trace_id) : undefined,
      chatId: String(event.event?.message?.chat_id ?? ""),
      userId: String(event.event?.sender?.sender_id?.open_id ?? ""),
      timestamp: Number(event.header?.create_time ?? this.now()),
      raw: payload,
      type: "text",
      text,
      mentions
    });
  }

  async sendMessage(response: UnifiedResponse): Promise<string> {
    const result = await this.tryPost("im/v1/messages?receive_id_type=chat_id", {
      receive_id: response.chatId,
      msg_type: "text",
      content: JSON.stringify({ text: response.text ?? "" })
    });
    return String((result as Record<string, unknown>).message_id ?? "");
  }

  async sendInteractiveCard(chatId: string, card: Record<string, unknown>): Promise<string> {
    const result = await this.tryPost("im/v1/messages?receive_id_type=chat_id", {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card)
    });
    return String((result as Record<string, unknown>).message_id ?? "");
  }

  async updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void> {
    await this.tryPost(`im/v1/messages/${cardToken}/patch`, {
      content: JSON.stringify(card)
    });
  }

  async resolveUserIdentity(userRef: string): Promise<{ externalUserId: string; displayName: string; }> {
    return {
      externalUserId: userRef,
      displayName: userRef
    };
  }

  private async tryPost(path: string, body: unknown): Promise<unknown> {
    const url = `${this.apiBaseUrl}/${path}`;
    try {
      const first = await this.httpClient.post(url, body);
      if (first.status >= 200 && first.status < 300) {
        return first.data;
      }
      throw new Error(`request failed: ${first.status}`);
    } catch {
      const retry = await this.httpClient.post(url, body);
      if (retry.status >= 200 && retry.status < 300) {
        return retry.data;
      }
      throw new ChannelError("CHANNEL_REQUEST_FAILED", `feishu request failed for ${path}`);
    }
  }
}
