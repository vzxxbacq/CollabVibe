import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import {
  BaseChannelAdapter,
  ChannelError,
  createLogger,
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
  private readonly log = createLogger("feishu");

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
    const data = (result as { data?: { message_id?: string } }).data;
    this.log.info({ chatId: response.chatId, messageId: data?.message_id }, "sendMessage");
    return String(data?.message_id ?? "");
  }

  async sendInteractiveCard(
    chatId: string,
    card: Record<string, unknown>,
    receiveIdType: "chat_id" | "open_id" = "chat_id"
  ): Promise<string> {
    const result = await this.tryPost(`im/v1/messages?receive_id_type=${receiveIdType}`, {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify(card)
    });
    const data = (result as { data?: { message_id?: string } }).data;
    this.log.info({ messageId: data?.message_id }, "sendInteractiveCard");
    return String(data?.message_id ?? "");
  }

  async pinMessage(messageId: string): Promise<void> {
    await this.tryPost("im/v1/pins", {
      message_id: messageId
    });
  }

  async updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void> {
    await this.tryPatch(`im/v1/messages/${cardToken}`, {
      content: JSON.stringify(card)
    });
    this.log.info({ cardToken }, "updateInteractiveCard");
  }

  async createCardEntity(card: Record<string, unknown>): Promise<string> {
    const result = await this.tryPost("cardkit/v1/cards", {
      type: "card_json",
      data: JSON.stringify(card)
    });
    const data = result as { data?: { card_id?: string; card?: { card_id?: string } } };
    const cardId = String(data.data?.card_id ?? data.data?.card?.card_id ?? "");
    if (!cardId) {
      throw new ChannelError("CHANNEL_REQUEST_FAILED", "feishu createCardEntity missing card_id");
    }
    this.log.info({ cardId }, "createCardEntity");
    return cardId;
  }

  async sendCardEntity(
    chatId: string,
    cardId: string,
    receiveIdType: "chat_id" | "open_id" = "chat_id"
  ): Promise<string> {
    const result = await this.tryPost(`im/v1/messages?receive_id_type=${receiveIdType}`, {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify({
        type: "card",
        data: { card_id: cardId }
      })
    });
    const data = (result as { data?: { message_id?: string } }).data;
    this.log.info({ chatId, cardId, messageId: data?.message_id }, "sendCardEntity");
    return String(data?.message_id ?? "");
  }

  async updateCardSettings(cardId: string, settings: Record<string, unknown>, sequence: number): Promise<void> {
    await this.tryPatch(`cardkit/v1/cards/${cardId}/settings`, {
      settings: JSON.stringify(settings),
      sequence,
      uuid: randomUUID()
    });
    this.log.info({ cardId, sequence }, "updateCardSettings");
  }

  async streamCardElement(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
    await this.tryPut(`cardkit/v1/cards/${cardId}/elements/${elementId}/content`, {
      content,
      sequence,
      uuid: randomUUID()
    });
    this.log.info({ cardId, elementId, sequence }, "streamCardElement");
  }

  async updateCardElement(cardId: string, elementId: string, element: Record<string, unknown>, sequence: number): Promise<void> {
    await this.tryPut(`cardkit/v1/cards/${cardId}/elements/${elementId}`, {
      element: JSON.stringify(element),
      sequence,
      uuid: randomUUID()
    });
    this.log.info({ cardId, elementId, sequence }, "updateCardElement");
  }

  async resolveUserIdentity(userRef: string): Promise<{ externalUserId: string; displayName: string; }> {
    const name = await this.getUserDisplayName(userRef);
    return {
      externalUserId: userRef,
      displayName: name === this.formatUserDisplayName(userRef) ? userRef : name
    };
  }

  /** 用户显示名缓存 */
  private readonly userNameCache = new Map<string, string>();

  private pickUserDisplayName(...candidates: Array<unknown>): string {
    for (const candidate of candidates) {
      const normalized = String(candidate ?? "").trim();
      if (normalized && normalized.toLowerCase() !== "unknown") {
        return normalized;
      }
    }
    return "";
  }

  private formatUserDisplayName(userId: string, displayName?: string): string {
    const suffix = userId ? userId.slice(-6) : "unknown";
    const name = String(displayName ?? "").trim() || "unknown";
    return `${name}(${suffix})`;
  }

  /**
   * 从飞书通讯录 API 获取用户显示名（带缓存）。
   * GET /contact/v3/users/:user_id?user_id_type=open_id
   */
  async getUserDisplayName(userId: string): Promise<string> {
    if (!userId) return this.formatUserDisplayName("");
    const cached = this.userNameCache.get(userId);
    if (cached) return cached;
    try {
      const result = await this.tryGet(`contact/v3/users/${userId}?user_id_type=open_id`);
      this.log.debug({ userId, result: JSON.stringify(result).slice(0, 500) }, "getUserDisplayName raw response");
      const user = (result as { data?: { user?: Record<string, unknown> } })?.data?.user;
      const displayName = this.pickUserDisplayName(
        user?.nickname,
        user?.name,
        user?.en_name
      );
      const resolved = this.formatUserDisplayName(userId, displayName);
      this.log.info({ userId, resolved }, "getUserDisplayName");
      this.userNameCache.set(userId, resolved);
      return resolved;
    } catch (err) {
      this.log.warn({ userId, err: err instanceof Error ? err.message : String(err) }, "getUserDisplayName failed");
      const fallback = this.formatUserDisplayName(userId);
      this.userNameCache.set(userId, fallback);
      return fallback;
    }
  }

  /**
   * 拉取群成员列表（分页），返回 open_id 数组。
   * GET /im/v1/chats/{chatId}/members?member_id_type=open_id
   */
  async listChatMembers(chatId: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const qs = `member_id_type=open_id&page_size=50${pageToken ? `&page_token=${pageToken}` : ""}`;
        const result = await this.tryGet(`im/v1/chats/${chatId}/members?${qs}`);
        const data = result as { data?: { items?: Array<{ member_id?: string }>; page_token?: string; has_more?: boolean } };
        for (const item of data?.data?.items ?? []) {
          if (item.member_id) ids.push(item.member_id);
        }
        pageToken = data?.data?.has_more ? data?.data?.page_token : undefined;
      } while (pageToken);
    } catch (err) {
      this.log.warn({ chatId, err: err instanceof Error ? err.message : String(err) }, "listChatMembers failed");
    }
    return ids;
  }

  async downloadMessageFile(params: {
    messageId: string;
    fileKey: string;
    targetDir: string;
    fileName?: string;
  }): Promise<{ localPath: string; originalName?: string }> {
    if (!this.httpClient.getBinary) {
      throw new ChannelError("CHANNEL_REQUEST_FAILED", "feishu http client does not support binary download");
    }
    await mkdir(params.targetDir, { recursive: true });
    const response = await this.httpClient.getBinary(
      `${this.apiBaseUrl}/im/v1/messages/${params.messageId}/resources/${params.fileKey}?type=file`,
      { Accept: "application/octet-stream" }
    );
    const disposition = response.headers?.["content-disposition"] ?? "";
    const originalName = params.fileName
      ?? decodeContentDispositionFilename(disposition)
      ?? `${params.fileKey}.bin`;
    const localPath = join(params.targetDir, sanitizeFilename(originalName));
    await writeFile(localPath, Buffer.from(response.data));
    return { localPath, originalName };
  }

  private async tryPost(path: string, body: unknown): Promise<unknown> {
    return this.tryRequest("post", path, body);
  }

  private async tryPatch(path: string, body: unknown): Promise<unknown> {
    return this.tryRequest("patch", path, body);
  }

  private async tryPut(path: string, body: unknown): Promise<unknown> {
    return this.tryRequest("put", path, body);
  }

  private async tryGet(path: string): Promise<unknown> {
    const url = `${this.apiBaseUrl}/${path}`;
    try {
      const first = await this.httpClient.get(url);
      if (first.status >= 200 && first.status < 300) {
        return first.data;
      }
      throw new Error(`request failed: ${first.status}`);
    } catch {
      const retry = await this.httpClient.get(url);
      if (retry.status >= 200 && retry.status < 300) {
        return retry.data;
      }
      throw new ChannelError("CHANNEL_REQUEST_FAILED", `feishu GET failed for ${path}`);
    }
  }

  private async tryDelete(path: string): Promise<unknown> {
    const url = `${this.apiBaseUrl}/${path}`;
    try {
      const first = await this.httpClient.delete(url);
      if (first.status >= 200 && first.status < 300) {
        return first.data;
      }
      throw new Error(`request failed: ${first.status}`);
    } catch {
      const retry = await this.httpClient.delete(url);
      if (retry.status >= 200 && retry.status < 300) {
        return retry.data;
      }
      throw new ChannelError("CHANNEL_REQUEST_FAILED", `feishu DELETE failed for ${path}`);
    }
  }

  /**
   * Bot leaves a chat group.
   * Feishu API: DELETE /im/v1/chats/{chatId}/members/me_join
   */
  async leaveChat(chatId: string): Promise<void> {
    try {
      await this.tryDelete(`im/v1/chats/${chatId}/members/me_join`);
      this.log.info({ chatId }, "leaveChat: bot left chat");
    } catch (err) {
      this.log.warn({ chatId, err: err instanceof Error ? err.message : String(err) }, "leaveChat failed");
    }
  }

  private async tryRequest(method: "post" | "put" | "patch", path: string, body: unknown): Promise<unknown> {
    const url = `${this.apiBaseUrl}/${path}`;
    try {
      const first = await this.httpClient[method](url, body);
      if (first.status >= 200 && first.status < 300) {
        return first.data;
      }
      throw new Error(`request failed: ${first.status}`);
    } catch {
      const retry = await this.httpClient[method](url, body);
      if (retry.status >= 200 && retry.status < 300) {
        return retry.data;
      }
      throw new ChannelError("CHANNEL_REQUEST_FAILED", `feishu request failed for ${path}`);
    }
  }
}

function sanitizeFilename(name: string): string {
  const sanitized = name.replace(/[\\/]/g, "_").replace(/\.\.+/g, ".");
  return sanitized || "upload.bin";
}

function decodeContentDispositionFilename(header: string): string | undefined {
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) return decodeURIComponent(utf8[1]);
  const basic = /filename="?([^"]+)"?/i.exec(header);
  return basic?.[1];
}
