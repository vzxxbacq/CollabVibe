import { describe, expect, it } from "vitest";

import { renderMembersPage } from "../../src/pages";

describe("members-page", () => {
  it("hides management actions for unauthorized roles", () => {
    const root = document.createElement("div");
    renderMembersPage(
      root,
      [
        { userId: "u1", role: "developer" },
        { userId: "u2", role: "approver" }
      ],
      false
    );

    const buttons = [...root.querySelectorAll("button")] as HTMLButtonElement[];
    expect(buttons.length).toBe(2);
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});
