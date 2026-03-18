import { describe, expect, it } from "vitest";

import { renderConnectivityPanel } from "../../src/pages";

describe("connectivity-panel", () => {
  it("renders connecting/success/failed states", () => {
    const root = document.createElement("div");

    renderConnectivityPanel(root, "connecting");
    expect((root.querySelector("button") as HTMLButtonElement).disabled).toBe(true);

    renderConnectivityPanel(root, "success", "连接成功");
    expect(root.textContent).toContain("连接成功");

    renderConnectivityPanel(root, "failed", "连接失败");
    expect(root.textContent).toContain("连接失败");
  });
});
