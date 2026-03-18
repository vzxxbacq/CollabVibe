import { describe, expect, it } from "vitest";

import { renderProjectPage } from "../../src/pages";

describe("project-page", () => {
  it("hides create action for read-only role and shows project list", () => {
    const root = document.createElement("div");
    renderProjectPage(
      root,
      [
        { id: "p1", name: "payment" },
        { id: "p2", name: "user" }
      ],
      false
    );

    expect(root.textContent).toContain("payment");
    const button = root.querySelector("button") as HTMLButtonElement;
    expect(button.hidden).toBe(true);
  });
});
