import { describe, expect, it } from "vitest";

import { toPlatformOutput } from "../../event/output-mapper";
import { projectThreadRouteKey } from "../../event/router-keys";
import { activeTurnKey, contextKey, threadKey, turnIdFromEvent } from "../../event/pipeline-keys";
import type { ThreadRouteBinding } from "../../event/pipeline";

describe("event mapping helpers", () => {
  it("maps IMOutputMessage to platform output", () => {
    const message = { kind: "content", turnId: "turn-1", delta: "hello" } as const;
    expect(toPlatformOutput(message)).toEqual({
      kind: "content",
      data: message,
    });
  });

  it("builds route keys", () => {
    const route: ThreadRouteBinding = {
      projectId: "p1",
      threadName: "main",
      threadId: "t1",
    };
    expect(projectThreadRouteKey("p1", "main")).toBe("p1:main");
    expect(contextKey("p1", "turn-1")).toBe("p1:turn-1");
    expect(threadKey(route)).toBe("p1:main");
    expect(activeTurnKey(route, "turn-1")).toBe("p1:main:turn-1");
  });

  it("extracts turnId from event", () => {
    expect(turnIdFromEvent({ type: "turn_started", turnId: "turn-1", title: "start" } as any)).toBe("turn-1");
    expect(turnIdFromEvent({ type: "agent_message", message: "x" } as any)).toBeNull();
  });
});
