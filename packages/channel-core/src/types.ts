export type UnifiedMessageType = "command" | "text" | "card_action";

export type UnifiedChannel = "feishu" | "dingtalk" | "unknown";

export interface UnifiedMessageBase {
  channel: UnifiedChannel;
  eventId: string;
  traceId?: string;
  chatId: string;
  userId: string;
  timestamp: number;
  raw: unknown;
}

export interface CommandMessage extends UnifiedMessageBase {
  type: "command";
  text: string;
  command: string;
  args: string[];
}

export interface TextMessage extends UnifiedMessageBase {
  type: "text";
  text: string;
  mentions: string[];
}

export interface CardActionMessage extends UnifiedMessageBase {
  type: "card_action";
  action: string;
  value: Record<string, string>;
}

export type UnifiedMessage = CommandMessage | TextMessage | CardActionMessage;

export interface UnifiedResponse {
  chatId: string;
  text?: string;
  card?: Record<string, unknown>;
}

export type IntentType =
  | "PROJECT_CREATE"
  | "PROJECT_LIST"
  | "THREAD_NEW"
  | "THREAD_RESUME"
  | "SKILL_INSTALL"
  | "SKILL_LIST"
  | "TURN_INTERRUPT"
  | "TURN_START"
  | "UNKNOWN";

export interface ParsedIntent {
  intent: IntentType;
  command?: string;
  args: Record<string, string | boolean>;
}
