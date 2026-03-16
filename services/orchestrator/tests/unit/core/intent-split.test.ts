import { describe, expect, it } from "vitest";

import { shouldRouteToAgent } from "../../../../../packages/channel-core/src/intent-router";

describe("intent-split", () => {
  it("blocks project command and unknown/card actions from codex routing", () => {
    expect(shouldRouteToAgent("PROJECT_CREATE", "command")).toBe(false);
    expect(shouldRouteToAgent("UNKNOWN", "command")).toBe(false);
    expect(shouldRouteToAgent("TURN_START", "card_action")).toBe(false);
  });

  it("allows codex turn intents to route", () => {
    expect(shouldRouteToAgent("TURN_START", "text")).toBe(true);
    expect(shouldRouteToAgent("THREAD_NEW", "command")).toBe(true);
    expect(shouldRouteToAgent("THREAD_JOIN", "command")).toBe(true);
  });
});
