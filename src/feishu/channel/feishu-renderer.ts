import type { IMNotification } from "../../../services/index";

export class FeishuRenderer {
  renderText(text: string): string {
    return text;
  }

  renderNotification(notification: IMNotification): string {
    return notification.detail ? `${notification.title}\n${notification.detail}` : notification.title;
  }
}
