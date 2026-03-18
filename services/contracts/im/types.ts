export type UnifiedMessageType = "command" | "text" | "card_action";

export type UnifiedChannel = "feishu" | "dingtalk" | "unknown";

/** Platform-specific origin info for media traceability — opaque to orchestrator */
export interface MediaOrigin {
  platform: string;       // "feishu" | "slack"
  resourceId: string;     // image_key / file_id / url_private
  messageId?: string;
}

/** Downloaded media attachment — platform-agnostic after download */
export interface MediaAttachment {
  type: "image" | "file";
  localPath: string;
  mimeType?: string;
  originalName?: string;
  origin?: MediaOrigin;
}

export interface UnifiedMessageBase {
  channel: UnifiedChannel;
  eventId: string;
  traceId?: string;
  chatId: string;
  userId: string;
  timestamp: number;
  raw: unknown;
  /** Media attachments — images/files downloaded by platform layer */
  attachments?: MediaAttachment[];
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
  /** File paths extracted from @file:path mentions in text */
  fileMentions?: string[];
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
  | "MODEL_LIST"
  | "THREAD_NEW"
  | "THREAD_SWITCH"
  | "THREAD_LIST"
  | "SKILL_INSTALL"
  | "SKILL_LIST"
  | "SKILL_REMOVE"
  | "SKILL_ADMIN"
  | "SNAPSHOT_LIST"
  | "THREAD_MERGE"
  | "TURN_INTERRUPT"
  | "TURN_START"
  | "USER_LIST"
  | "USER_ROLE"
  | "USER_ADD"
  | "USER_REMOVE"
  | "ADMIN_ADD"
  | "ADMIN_REMOVE"
  | "ADMIN_LIST"
  | "HELP"
  | "ADMIN_HELP"
  | "UNKNOWN";

export interface ParsedIntent {
  intent: IntentType;
  command?: string;
  args: Record<string, string | boolean>;
}
