import type { PlatformInboundAdapter, PlatformInput } from "../../../services/contracts/im/platform-input";

interface SlackInboundMessageLike {
  chatId?: string;
  userId?: string;
  text?: string;
  messageTs?: string;
  threadTs?: string;
}

export class SlackInboundAdapter implements PlatformInboundAdapter {
  toInput(event: unknown): PlatformInput | null {
    const input = event as SlackInboundMessageLike;
    const chatId = String(input.chatId ?? "");
    const userId = String(input.userId ?? "");
    if (!chatId || !userId) return null;
    return {
      kind: "message",
      platform: "slack",
      chatId,
      userId,
      text: String(input.text ?? ""),
      messageId: String(input.messageTs ?? `slack-${Date.now()}`),
      threadId: typeof input.threadTs === "string" ? input.threadTs : undefined,
      mentions: [],
      raw: event,
    };
  }
}
