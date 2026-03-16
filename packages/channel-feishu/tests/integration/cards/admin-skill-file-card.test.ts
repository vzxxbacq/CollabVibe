import { describe, expect, it, vi } from "vitest";

import { FeishuOutputAdapter } from "../../../src/feishu-output-adapter";

function makeClient() {
  return {
    sendMessage: vi.fn(async () => "msg-1"),
    sendInteractiveCard: vi.fn(async () => "card-token-1"),
    updateInteractiveCard: vi.fn(async () => undefined),
    pinMessage: vi.fn(async () => undefined)
  };
}

describe("admin skill file install card", () => {
  it("idle card removes pre-upload skill name input and uses explicit CTA", () => {
    const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
    const card = adapter.buildAdminSkillFileInstallCard();
    const serialized = JSON.stringify(card);

    expect(serialized).not.toContain('"name":"skill_name"');
    expect(serialized).toContain("开始等待上传");
    expect(serialized).toContain("最终名称在上传后的确认卡中填写或修改");
  });

  it("awaiting-upload card makes current waiting state explicit", () => {
    const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
    const card = adapter.buildAdminSkillFileInstallCard({ mode: "awaiting_upload" });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain("已进入上传等待状态");
    expect(serialized).toContain("等待文件上传中");
    expect(serialized).toContain("10 分钟内未上传会自动取消");
  });

  it("confirm card keeps editable final skill name input", () => {
    const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
    const card = adapter.buildAdminSkillFileConfirmCard({
      fileName: "demo.zip",
      pluginName: "demo-skill",
      sourceLabel: "Feishu 文件"
    });
    const serialized = JSON.stringify(card);

    expect(serialized).toContain('"name":"skill_name"');
    expect(serialized).toContain("最终 Skill 名称");
    expect(serialized).toContain("demo-skill");
  });
});
