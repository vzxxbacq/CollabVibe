export type PlatformId = "feishu" | "slack";

export interface PlatformMention {
  userId: string;
  name?: string;
}

export interface PlatformMessageInput {
  kind: "message";
  platform: PlatformId;
  chatId: string;
  userId: string;
  text: string;
  messageId: string;
  eventId?: string;
  threadId?: string;
  mentions?: PlatformMention[];
  raw?: unknown;
}

export interface PlatformSystemInput {
  kind: "system";
  platform: PlatformId;
  event: "bot_added" | "bot_removed" | "chat_bound";
  chatId: string;
  operatorId?: string;
  raw?: unknown;
}

export type PlatformInput = PlatformMessageInput | PlatformSystemInput;

export interface PlatformInboundAdapter {
  toInput(event: unknown): PlatformInput | null;
}
