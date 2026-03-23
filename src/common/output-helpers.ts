import type { NotificationOutput } from "./platform-output";

export function textNotification(text: string): NotificationOutput {
  return {
    kind: "notification",
    data: {
      kind: "notification",
      threadId: "",
      category: "agent_message",
      title: text,
    },
  };
}
