import { describe, expect, it } from "vitest";

import { TurnContext } from "../../../src/turn-context";

describe("turn-context", () => {
  it("builds summary with tokens and last message", () => {
    let now = 1_000;
    const ctx = new TurnContext("thr-1", "turn-1", undefined, () => now);
    ctx.setTokenUsage({ input: 100, output: 200 });
    ctx.setLastAgentMessage("done");
    now = 2_500;

    expect(ctx.toSummary()).toEqual({
      kind: "turn_summary",
      threadId: "thr-1",
      threadName: undefined,
      turnId: "turn-1",
      filesChanged: [],
      tokenUsage: { input: 100, output: 200 },
      duration: 1500,
      lastAgentMessage: "done"
    });
  });

  it("[C9d-2] returns empty summary fields when context has no updates", () => {
    const ctx = new TurnContext("thr-1", "turn-2", undefined, () => 2000);
    expect(ctx.toSummary()).toEqual({
      kind: "turn_summary",
      threadId: "thr-1",
      threadName: undefined,
      turnId: "turn-2",
      filesChanged: [],
      tokenUsage: undefined,
      duration: 0,
      lastAgentMessage: undefined
    });
  });

  it("[C9d-5] keeps latest token usage when setTokenUsage is called multiple times", () => {
    const ctx = new TurnContext("thr-1", "turn-5");
    ctx.setTokenUsage({ input: 1, output: 2 });
    ctx.setTokenUsage({ input: 10, output: 20 });
    expect(ctx.toSummary().tokenUsage).toEqual({ input: 10, output: 20 });
  });

  it("[C9d-6] computes duration from now() delta between constructor and toSummary", () => {
    let now = 100;
    const ctx = new TurnContext("thr-1", "turn-6", undefined, () => now);
    now = 760;
    expect(ctx.toSummary().duration).toBe(660);
  });

  it("includes threadName in summary when provided", () => {
    const ctx = new TurnContext("thr-1", "turn-7", "my-thread");
    expect(ctx.toSummary().threadName).toBe("my-thread");
  });
});
