import type { PlatformInboundAdapter, PlatformInput, PlatformMention } from "../../../services/contracts/im/platform-input";

interface FeishuInboundMessageData {
  message?: {
    chat_id?: string;
    content?: string;
    message_id?: string;
    mentions?: Array<{ id?: { open_id?: string }; name?: string }>;
  };
  sender?: { sender_id?: { open_id?: string } };
}

function parseText(rawContent: string): string {
  try {
    return String((JSON.parse(rawContent) as { text?: string }).text ?? "");
  } catch {
    return rawContent;
  }
}

export class FeishuInboundAdapter implements PlatformInboundAdapter {
  toInput(event: unknown): PlatformInput | null {
    const payload = event as FeishuInboundMessageData;
    const chatId = String(payload.message?.chat_id ?? "");
    const userId = String(payload.sender?.sender_id?.open_id ?? "");
    if (!chatId || !userId) return null;

    const mentions = Array.isArray(payload.message?.mentions)
      ? payload.message.mentions
        .map((item): PlatformMention | null => {
          const mentionedUserId = item?.id?.open_id ?? "";
          if (!mentionedUserId) return null;
          return { userId: mentionedUserId, name: item?.name };
        })
        .filter((item): item is PlatformMention => item !== null)
      : [];

    return {
      kind: "message",
      platform: "feishu",
      chatId,
      userId,
      text: parseText(String(payload.message?.content ?? "{}")),
      messageId: String(payload.message?.message_id ?? `feishu-${Date.now()}`),
      mentions,
      raw: event,
    };
  }
}
