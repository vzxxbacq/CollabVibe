import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StreamAggregator } from "../../../src/stream-aggregator";

describe("stream-aggregator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("merges deltas inside window into one output", () => {
    const aggregator = new StreamAggregator({
      windowMs: 500,
      maxWaitMs: 3_000,
      maxChars: 1_000
    });
    const outputs: string[] = [];

    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "a",
        streamKey: "message"
      },
      (chunk) => outputs.push(chunk.delta)
    );
    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "b",
        streamKey: "message"
      },
      (chunk) => outputs.push(chunk.delta)
    );
    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "c",
        streamKey: "message"
      },
      (chunk) => outputs.push(chunk.delta)
    );

    vi.advanceTimersByTime(500);
    expect(outputs).toEqual(["abc"]);
  });

  it("flushes immediately when max chars reached and keeps streams isolated", () => {
    const aggregator = new StreamAggregator({
      windowMs: 500,
      maxWaitMs: 3_000,
      maxChars: 3
    });
    const outputs: Array<{ key: string; delta: string }> = [];
    const collect = (chunk: { streamKey: string; delta: string }) => outputs.push({ key: chunk.streamKey, delta: chunk.delta });

    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "12",
        streamKey: "k1"
      },
      collect
    );
    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "3",
        streamKey: "k1"
      },
      collect
    );
    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "x",
        streamKey: "k2"
      },
      collect
    );

    expect(outputs).toContainEqual({ key: "k1", delta: "123" });
    expect(outputs).not.toContainEqual({ key: "k2", delta: "x" });
    vi.advanceTimersByTime(500);
    expect(outputs).toContainEqual({ key: "k2", delta: "x" });
  });

  it("flushes when max wait is reached", () => {
    const aggregator = new StreamAggregator({
      windowMs: 3_000,
      maxWaitMs: 1_000,
      maxChars: 100
    });
    const outputs: string[] = [];

    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "hello",
        streamKey: "message"
      },
      (chunk) => outputs.push(chunk.delta)
    );

    vi.advanceTimersByTime(1_000);
    expect(outputs).toEqual(["hello"]);
  });

  it("resets window timer when new delta arrives within window", () => {
    const aggregator = new StreamAggregator({
      windowMs: 500,
      maxWaitMs: 5_000,
      maxChars: 100
    });
    const outputs: string[] = [];

    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "a",
        streamKey: "message"
      },
      (chunk) => outputs.push(chunk.delta)
    );
    vi.advanceTimersByTime(400);
    aggregator.push(
      {
        kind: "stream",
        threadId: "thr-1",
        turnId: "turn-1",
        category: "message",
        delta: "b",
        streamKey: "message"
      },
      (chunk) => outputs.push(chunk.delta)
    );

    vi.advanceTimersByTime(499);
    expect(outputs).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(outputs).toEqual(["ab"]);
  });
});
