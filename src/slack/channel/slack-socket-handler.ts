// ─────────────────────────────────────────────────────────────────────────────
// SlackSocketHandler — Slack Socket Mode 事件处理
// ─────────────────────────────────────────────────────────────────────────────
//
// 通过 WebSocket 接收 Slack 事件:
//   - message events (用户发消息 → 创建 Codex turn)
//   - action events (用户点按钮 → 审批/撤销/停止)
//
// 类似飞书的 WebSocket 长连接模式，无需 HTTP 服务器。
// ─────────────────────────────────────────────────────────────────────────────

/** Slack Socket Mode 事件 */
export interface SlackSocketEvent {
  type: "events_api" | "interactive";
  envelope_id: string;
  payload: SlackEventPayload | SlackActionPayload;
}

/** Events API payload (message from user) */
export interface SlackEventPayload {
  type: "event_callback";
  event: {
    type: string;         // "message", "app_mention"
    channel: string;
    user?: string;
    text: string;
    ts: string;
    thread_ts?: string;
    subtype?: string;
    bot_id?: string;
  };
}

/** Interactive payload (button click) */
export interface SlackActionPayload {
  type: "block_actions";
  user: { id: string; name: string };
  channel: { id: string };
  message: { ts: string };
  actions: Array<{
    action_id: string;
    value: string;        // JSON string: { action, callId, turnId, chatId }
    block_id: string;
  }>;
}

/** 消息处理器 — 收到用户消息时调用 */
export type MessageHandler = (params: {
  chatId: string;
  userId: string;
  text: string;
  messageTs: string;
  threadTs?: string;
}) => Promise<void>;

/** 操作处理器 — 收到按钮点击时调用 */
export type ActionHandler = (params: {
  chatId: string;
  userId: string;
  action: string;
  messageTs?: string;
  callId?: string;
  turnId?: string;
  threadId?: string;
  approvalType?: "command_exec" | "file_change";
  branchName?: string;
  baseBranch?: string;
  filePath?: string;
  prompt?: string;
}) => Promise<void>;

/**
 * SlackSocketHandler — Socket Mode WebSocket 事件处理器。
 *
 * 使用方式:
 * ```typescript
 * const handler = new SlackSocketHandler();
 * handler.onMessage(async ({ chatId, text }) => { ... });
 * handler.onAction(async ({ chatId, action, turnId }) => { ... });
 * handler.handleEvent(socketEvent);  // 从 WebSocket 接收事件
 * ```
 */
export class SlackSocketHandler {
  private messageHandler: MessageHandler | null = null;
  private actionHandler: ActionHandler | null = null;

  /** 注册消息处理器 */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** 注册操作处理器 */
  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  /**
   * 处理 Socket Mode 事件。
   * 返回 envelope_id 用于 ACK。
   */
  async handleEvent(event: SlackSocketEvent): Promise<string> {
    const envelopeId = event.envelope_id;

    if (event.type === "events_api") {
      const payload = event.payload as SlackEventPayload;
      if (
        !payload.event.subtype &&
        !payload.event.bot_id &&
        payload.event.user &&
        (payload.event.type === "message" || payload.event.type === "app_mention")
      ) {
        await this.messageHandler?.({
          chatId: payload.event.channel,
          userId: payload.event.user,
          text: payload.event.text,
          messageTs: payload.event.ts,
          threadTs: payload.event.thread_ts
        });
      }
    }

    if (event.type === "interactive") {
      const payload = event.payload as SlackActionPayload;
      if (payload.type === "block_actions" && payload.actions.length > 0) {
        const actionData = payload.actions[0];

        let parsed: Record<string, string> = {};
        try {
          parsed = JSON.parse(actionData.value) as Record<string, string>;
        } catch {
          parsed = { action: actionData.action_id };
        }

        const actionName = parsed.action ?? actionData.action_id;
        const includeMessageTs = actionName.startsWith("help_");

        await this.actionHandler?.({
          chatId: payload.channel.id,
          userId: payload.user.id,
          action: actionName,
          ...(includeMessageTs ? { messageTs: payload.message.ts } : {}),
          callId: parsed.callId,
          turnId: parsed.turnId,
          ...(typeof parsed.threadId === "string" ? { threadId: parsed.threadId } : {}),
          ...(parsed.approvalType === "command_exec" || parsed.approvalType === "file_change"
            ? { approvalType: parsed.approvalType }
            : {}),
          ...(typeof parsed.branchName === "string" ? { branchName: parsed.branchName } : {}),
          ...(typeof parsed.baseBranch === "string" ? { baseBranch: parsed.baseBranch } : {}),
          ...(typeof parsed.filePath === "string" ? { filePath: parsed.filePath } : {}),
          ...(typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {})
        });
      }
    }

    return envelopeId;
  }
}
