import { describe, expect, it } from "vitest";

import { renderAuditPage } from "../../src/pages";

describe("audit-page", () => {
  it("renders invalid filter and empty state", () => {
    const root = document.createElement("div");

    renderAuditPage(root, [], true);
    expect(root.textContent).toContain("筛选条件无效");

    renderAuditPage(root, [], false);
    expect(root.textContent).toContain("暂无审计数据");
  });
});
