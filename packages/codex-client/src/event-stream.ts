import type { CodexNotification, CodexItem } from "./types";

export type EventHandler = (event: CodexNotification) => void;

function getNotificationItem(event: CodexNotification): CodexItem | null {
  if (!event.method.startsWith("item/")) {
    return null;
  }

  const item = event.params.item;
  if (typeof item !== "object" || item === null) {
    return null;
  }

  const candidate = item as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.length === 0) {
    return null;
  }

  return candidate as CodexItem;
}

function notificationKey(event: CodexNotification): string {
  const item = getNotificationItem(event);
  if (item) {
    return `item:${event.method}:${item.id}`;
  }

  return `raw:${event.method}:${JSON.stringify(event.params)}`;
}

export class EventStreamConsumer {
  private readonly seenEventKeys = new Set<string>();

  resetDedup(): void {
    this.seenEventKeys.clear();
  }

  async consume(stream: AsyncIterable<CodexNotification>, onEvent: EventHandler): Promise<void> {
    for await (const event of stream) {
      const key = notificationKey(event);
      if (this.seenEventKeys.has(key)) {
        continue;
      }
      this.seenEventKeys.add(key);
      onEvent(event);
    }
  }

  async consumeWithReconnect(
    createStream: () => AsyncIterable<CodexNotification>,
    onEvent: EventHandler,
    maxReconnects: number
  ): Promise<number> {
    let attempts = 0;
    while (attempts <= maxReconnects) {
      try {
        await this.consume(createStream(), onEvent);
        return attempts;
      } catch {
        attempts += 1;
        if (attempts > maxReconnects) {
          throw new Error("stream reconnect limit reached");
        }
        const delayMs = Math.min(1000 * 2 ** attempts, 30000);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return attempts;
  }
}
