/**
 * @module src/feishu/feishu-ws-app
 * @layer Feishu (platform-specific)
 *
 * Feishu WebSocket application wrapper.
 *
 * ## Responsibilities
 * - Start Lark WSClient with EventDispatcher
 * - Register handlers for: im.message.receive_v1, card.action.trigger,
 *   im.chat.member.bot.added_v1, im.chat.member.user.added_v1,
 *   application.bot.menu_v6
 * - Delegate actual processing to callback functions provided via FeishuWsAppOptions
 *
 * ## Consumers
 * - `src/server.ts` — creates FeishuWsApp and passes handler callbacks
 */
import * as Lark from "@larksuiteoapi/node-sdk";
import { createLogger } from "../logging";

interface FeishuWsAppOptions {
  appId: string;
  appSecret: string;
  loggerLevel?: number;
  onInboundMessage(data: Record<string, unknown>): Promise<void>;
  onCardAction(data: Record<string, unknown>): Promise<unknown>;
  onBotAdded(data: Record<string, unknown>): Promise<void>;
  onBotRemoved(data: Record<string, unknown>): Promise<void>;
  onMemberJoined(data: Record<string, unknown>): Promise<void>;
  onBotMenuEvent(data: Record<string, unknown>): Promise<void>;
}

export class FeishuWsApp {
  private readonly log = createLogger("feishu");

  constructor(private readonly options: FeishuWsAppOptions) { }

  private dispatchBackground(label: string, task: () => Promise<unknown>): Promise<void> {
    void task().catch((error) => {
      this.log.error({ err: error instanceof Error ? error.message : String(error), event: label }, "Feishu background handler failed");
    });
    return Promise.resolve();
  }

  async start(): Promise<Lark.WSClient> {
    this.log.info({ loggerLevel: this.options.loggerLevel ?? Lark.LoggerLevel.info }, "starting Feishu WS app");
    const eventDispatcher = new Lark.EventDispatcher({});
    eventDispatcher.register({
      "im.message.receive_v1": (data: Record<string, unknown>) =>
        this.dispatchBackground("im.message.receive_v1", () => this.options.onInboundMessage(data)),
      "card.action.trigger": (data: Record<string, unknown>) => this.options.onCardAction(data),
      "im.chat.member.bot.added_v1": (data: Record<string, unknown>) =>
        this.dispatchBackground("im.chat.member.bot.added_v1", () => this.options.onBotAdded(data)),
      "im.chat.member.bot.deleted_v1": (data: Record<string, unknown>) =>
        this.dispatchBackground("im.chat.member.bot.deleted_v1", () => this.options.onBotRemoved(data)),
      "im.chat.member.user.added_v1": (data: Record<string, unknown>) =>
        this.dispatchBackground("im.chat.member.user.added_v1", () => this.options.onMemberJoined(data)),
      "application.bot.menu_v6": (data: Record<string, unknown>) =>
        this.dispatchBackground("application.bot.menu_v6", () => this.options.onBotMenuEvent(data))
    });

    const wsClient = new Lark.WSClient({
      appId: this.options.appId,
      appSecret: this.options.appSecret,
      loggerLevel: this.options.loggerLevel ?? Lark.LoggerLevel.info
    });

    await wsClient.start({ eventDispatcher });
    this.log.info("Feishu WS app started");
    return wsClient;
  }
}
