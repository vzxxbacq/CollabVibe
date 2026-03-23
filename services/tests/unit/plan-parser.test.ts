import { describe, expect, it } from "vitest";

import {
  extractMarkdownHeading,
  looksLikePlanStep,
  normalizePlanStatus,
  parsePlanDraft,
  stripPlanStepPrefix,
} from "../../event/plan-parser";
import { buildPlanUpdateMessage } from "../../event/plan-output";

describe("plan parser", () => {
  it("normalizes status markers", () => {
    expect(normalizePlanStatus("[x] done")).toBe("completed");
    expect(normalizePlanStatus("[~] working")).toBe("in_progress");
    expect(normalizePlanStatus("- todo")).toBe("pending");
    expect(normalizePlanStatus("1. pending item")).toBe("pending");
  });

  it("extracts markdown heading", () => {
    expect(extractMarkdownHeading("## Section A")).toBe("Section A");
    expect(extractMarkdownHeading("plain text")).toBeNull();
  });

  it("detects and strips plan step prefixes", () => {
    expect(looksLikePlanStep("第1步：准备数据")).toBe(true);
    expect(stripPlanStepPrefix("第1步：准备数据")).toBe("准备数据");
    expect(stripPlanStepPrefix("[x] 完成验证")).toBe("完成验证");
  });

  it("parses draft into explanation and items", () => {
    const parsed = parsePlanDraft([
      "# Rollout plan",
      "先解释背景",
      "## Phase 1",
      "1. 建目录",
      "[x] 写单元测试",
      "补充说明",
    ].join("\n"));

    expect(parsed).toEqual({
      explanation: "Rollout plan\n先解释背景\nPhase 1",
      items: [
        { step: "建目录", status: "pending" },
        { step: "写单元测试 补充说明", status: "completed" },
      ],
    });
  });

  it("falls back to explanation-only single pending item", () => {
    expect(parsePlanDraft("only explanation")).toEqual({
      explanation: "only explanation",
      items: [{ step: "only explanation", status: "pending" }],
    });
    expect(parsePlanDraft("")).toBeNull();
  });
});

describe("plan output", () => {
  it("builds plan_update message", () => {
    expect(buildPlanUpdateMessage("turn-1", {
      explanation: "exp",
      items: [{ step: "a", status: "pending" }]
    })).toEqual({
      kind: "plan_update",
      turnId: "turn-1",
      explanation: "exp",
      plan: [{ step: "a", status: "pending" }],
    });
  });
});
