import { describe, expect, it, vi } from "vitest";

import { FeishuOutputAdapter } from "../../../src/feishu-output-adapter";
import { TurnCardManager } from "../../../src/feishu-turn-card";
import { getLastUpdatedCard, getUpdatedCard } from "../../helpers/card-assertions";
import { buildApprovalRequest, buildNotification, buildProgressEvent, buildTurnSummary } from "../../helpers/fixtures";
import { makeFeishuClientMock } from "../../helpers/feishu-client-mock";

describe("output-adapter", () => {
  it("creates card on turn start and updates message stream", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification());
    await adapter.appendContent("chat-1", "turn-1", "hello");
    await vi.advanceTimersByTimeAsync(500);

    expect(client.sendInteractiveCard).toHaveBeenCalledTimes(1);
    expect(client.updateInteractiveCard).toHaveBeenCalled();
    expect(getUpdatedCard(client)).toMatchObject({
      body: { elements: expect.arrayContaining([expect.objectContaining({ tag: "markdown" })]) }
    });
    vi.useRealTimers();
  });

  it("shows lifecycle progress and turn summary footer", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.updateProgress("chat-1", buildProgressEvent({ label: "run tests" }));
    await adapter.notify("chat-1", buildNotification({ category: "turn_complete", title: "完成" }));
    await adapter.completeTurn("chat-1", buildTurnSummary({ tokenUsage: { input: 1, output: 2 } }));

    expect(client.updateInteractiveCard).toHaveBeenCalledTimes(2);
    const cardJson = JSON.stringify(getUpdatedCard(client, 1));
    expect(cardJson).toContain("执行过程");
    expect(cardJson).toContain("完成 (无文件修改)");
  });

  it("keeps plan deltas out of final card when no structured plan exists", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-plan-delta" }));
    await adapter.appendPlan("chat-1", "turn-plan-delta", "草稿计划\n- 步骤一");
    await vi.advanceTimersByTimeAsync(500);
    await adapter.completeTurn("chat-1", buildTurnSummary({
      turnId: "turn-plan-delta",
      lastAgentMessage: "最终回复",
      tokenUsage: { input: 1, output: 1 }
    }));

    const cardJson = JSON.stringify(getLastUpdatedCard(client));
    expect(cardJson).toContain("最终回复");
    expect(cardJson).not.toContain("执行计划");
    expect(cardJson).not.toContain("草稿计划");
    vi.useRealTimers();
  });

  it("renders structured plan section in final card", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.updatePlan("chat-1", {
      kind: "plan_update",
      turnId: "turn-plan-structured",
      explanation: "正式计划",
      plan: [{ step: "步骤一", status: "in_progress" }]
    });
    await adapter.completeTurn("chat-1", buildTurnSummary({
      turnId: "turn-plan-structured",
      lastAgentMessage: "最终回复",
      tokenUsage: { input: 1, output: 1 }
    }));

    const cardJson = JSON.stringify(getLastUpdatedCard(client));
    expect(cardJson).toContain("执行计划");
    expect(cardJson).toContain("正式计划");
    expect(cardJson).toContain("步骤一");
  });

  it("prefers structured plan over earlier plan draft", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-plan-mixed" }));
    await adapter.appendPlan("chat-1", "turn-plan-mixed", "临时草稿");
    await vi.advanceTimersByTimeAsync(500);
    await adapter.updatePlan("chat-1", {
      kind: "plan_update",
      turnId: "turn-plan-mixed",
      explanation: "正式计划",
      plan: [{ step: "正式步骤", status: "completed" }]
    });
    await adapter.completeTurn("chat-1", buildTurnSummary({
      turnId: "turn-plan-mixed",
      lastAgentMessage: "最终回复",
      tokenUsage: { input: 1, output: 1 }
    }));

    const cardJson = JSON.stringify(getLastUpdatedCard(client));
    expect(cardJson).toContain("正式计划");
    expect(cardJson).toContain("正式步骤");
    expect(cardJson).not.toContain("临时草稿");
    vi.useRealTimers();
  });

  it("uses plan draft only for streaming progress until structured plan arrives", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const turnCard = new TurnCardManager(client, { cardThrottleMs: 0 });

    turnCard.appendPlan("chat-1", "turn-native-plan", "草稿计划");
    await vi.advanceTimersByTimeAsync(500);
    const draftState = turnCard.getOrCreateState("chat-1", "turn-native-plan");
    const draftProgress = (turnCard as unknown as { renderStreamingProgress(state: unknown): string }).renderStreamingProgress(draftState);
    expect(draftProgress).toContain("草稿计划");

    await turnCard.updatePlan("chat-1", {
      kind: "plan_update",
      turnId: "turn-native-plan",
      explanation: "正式计划",
      plan: [{ step: "正式步骤", status: "completed" }]
    });

    const finalState = turnCard.getOrCreateState("chat-1", "turn-native-plan");
    const finalProgress = (turnCard as unknown as { renderStreamingProgress(state: unknown): string }).renderStreamingProgress(finalState);
    expect(finalProgress).toContain("正式计划");
    expect(finalProgress).toContain("正式步骤");
    expect(finalProgress).not.toContain("草稿计划");
    vi.useRealTimers();
  });

  it("sends approval card with action buttons", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.requestApproval("chat-1", buildApprovalRequest({
      turnId: "turn-1",
      approvalId: "approval-1",
      callId: "call-1",
      description: "审批命令"
    }));

    expect(client.sendInteractiveCard).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        schema: "2.0",
        body: expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({ tag: "column_set" })
          ])
        })
      })
    );
  });
});
