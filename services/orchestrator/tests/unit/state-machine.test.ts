import { describe, expect, it } from "vitest";

import { ConversationStateMachine } from "../../src/session/state-machine";

describe("state-machine", () => {
  it("rejects illegal transition paths", () => {
    const machine = new ConversationStateMachine();
    expect(machine.getState()).toBe("IDLE");
    expect(() => machine.transition("AWAITING_APPROVAL")).toThrowError("illegal transition IDLE -> AWAITING_APPROVAL");
  });

  it("supports running -> awaiting approval -> running lifecycle", () => {
    const machine = new ConversationStateMachine();
    expect(machine.transition("RUNNING")).toBe("RUNNING");
    expect(machine.transition("AWAITING_APPROVAL")).toBe("AWAITING_APPROVAL");
    expect(machine.transition("RUNNING")).toBe("RUNNING");
    expect(machine.transition("IDLE")).toBe("IDLE");
  });
});
