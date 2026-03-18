import { describe, expect, it } from "vitest";

describe("admin-ui dom baseline", () => {
  it("has a browser-like DOM runtime", () => {
    const div = document.createElement("div");
    div.textContent = "hello";
    expect(div.textContent).toBe("hello");
  });
});
