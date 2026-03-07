import { describe, expect, it, vi } from "vitest";

import { EventStreamConsumer } from "../src/event-stream";
import type { CodexNotification } from "../src/types";

async function* makeStream(events: CodexNotification[]): AsyncIterable<CodexNotification> {
  for (const event of events) {
    yield event;
  }
}

describe("event stream consumer", () => {
  it("consumes notifications and deduplicates by method + item id", async () => {
    const consumer = new EventStreamConsumer();
    const received: string[] = [];

    await consumer.consume(
      makeStream([
        { method: "item/started", params: { item: { id: "it-1", type: "agentMessage" } } },
        { method: "item/started", params: { item: { id: "it-2", type: "agentMessage" } } },
        { method: "item/started", params: { item: { id: "it-1", type: "agentMessage" } } },
        { method: "item/completed", params: { item: { id: "it-1", type: "agentMessage" } } }
      ]),
      (event) => {
        const item = event.params?.item as { id: string };
        received.push(`${event.method}:${item.id}`);
      }
    );

    expect(received).toEqual(["item/started:it-1", "item/started:it-2", "item/completed:it-1"]);
  });

  it("reconnects after stream failure", async () => {
    vi.useFakeTimers();
    try {
      const consumer = new EventStreamConsumer();
      const received: string[] = [];
      let callCount = 0;

      const createStream = () => {
        callCount += 1;
        if (callCount === 1) {
          return (async function* failing() {
            yield { method: "item/started", params: { item: { id: "it-1", type: "agentMessage" } } };
            throw new Error("disconnect");
          })();
        }

        return makeStream([{ method: "item/started", params: { item: { id: "it-2", type: "agentMessage" } } }]);
      };

      const consumePromise = consumer.consumeWithReconnect(
        createStream,
        (event) => {
          const item = event.params?.item as { id: string };
          received.push(item.id);
        },
        1
      );

      await vi.advanceTimersByTimeAsync(2000);
      const attempts = await consumePromise;

      expect(attempts).toBe(1);
      expect(received).toEqual(["it-1", "it-2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("throws after reaching reconnect limit", async () => {
    vi.useFakeTimers();
    try {
      const consumer = new EventStreamConsumer();
      const consumePromise = consumer.consumeWithReconnect(
        () => {
          throw new Error("fail");
        },
        () => undefined,
        2
      );
      const rejected = expect(consumePromise).rejects.toThrowError("stream reconnect limit reached");

      await vi.advanceTimersByTimeAsync(6000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });

  it("can clear dedup cache to avoid unbounded growth", async () => {
    const consumer = new EventStreamConsumer();

    const events: CodexNotification[] = Array.from({ length: 1000 }, (_, index) => ({
      method: "item/started",
      params: {
        item: {
          id: `it-${index}`,
          type: "agentMessage"
        }
      }
    }));

    await consumer.consume(makeStream(events), () => undefined);

    expect((consumer as unknown as { seenEventKeys: Set<string> }).seenEventKeys.size).toBe(1000);

    consumer.resetDedup();

    expect((consumer as unknown as { seenEventKeys: Set<string> }).seenEventKeys.size).toBe(0);
  });

  it("deduplicates non-item notifications by method + params", async () => {
    const consumer = new EventStreamConsumer();
    const received: CodexNotification[] = [];

    await consumer.consume(
      makeStream([
        { method: "turn/completed", params: { turnId: "t1" } },
        { method: "turn/completed", params: { turnId: "t1" } }
      ]),
      (event) => {
        received.push(event);
      }
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ method: "turn/completed", params: { turnId: "t1" } });
  });

  it("applies backoff delay before reconnecting", async () => {
    vi.useFakeTimers();
    try {
      const consumer = new EventStreamConsumer();
      let createStreamCalls = 0;
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const createStream = () => {
        createStreamCalls += 1;
        if (createStreamCalls === 1) {
          return (async function* failedStream() {
            throw new Error("disconnect");
          })();
        }
        return makeStream([]);
      };

      const consumePromise = consumer.consumeWithReconnect(createStream, () => undefined, 1);
      await Promise.resolve();

      expect(createStreamCalls).toBe(1);

      await vi.advanceTimersByTimeAsync(2000);
      await expect(consumePromise).resolves.toBe(1);
      expect(createStreamCalls).toBe(2);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
