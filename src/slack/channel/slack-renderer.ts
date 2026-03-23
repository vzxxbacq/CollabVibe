import type { SlackBlock } from "./slack-message-client";
import { buildNotificationBlocks, section } from "./slack-block-builder";
import type { IMNotification } from "../../../services/contracts/im/im-output";

export class SlackRenderer {
  renderText(text: string): { text: string; blocks: SlackBlock[] } {
    return { text, blocks: [section(text)] };
  }

  renderNotification(notification: IMNotification): { text: string; blocks: SlackBlock[] } {
    return {
      text: notification.title,
      blocks: buildNotificationBlocks(notification.category, notification.title, notification.detail)
    };
  }
}
