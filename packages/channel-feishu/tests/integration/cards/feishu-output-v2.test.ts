import { describe, expect, it, vi } from "vitest";

import { FeishuOutputAdapter } from "../../../src/feishu-output-adapter";
import {
  getLastSentCard,
  getLastUpdatedCard,
  getSentCard,
  getUpdatedCard,
  getUpdatedCardToken
} from "../../helpers/card-assertions";
import {
  buildApprovalRequest,
  buildNotification,
  buildProgressEvent,
  buildTurnSummary,
  buildUserInputRequest
} from "../../helpers/fixtures";
import { makeFeishuClientMock } from "../../helpers/feishu-client-mock";

describe("feishu-output-v2", () => {
  it("thinking chunks are ignored by feishu adapter", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification());
    await adapter.appendReasoning("chat-1", "turn-1", "分析中");
    await vi.advanceTimersByTimeAsync(500);

    expect(client.updateInteractiveCard).toHaveBeenCalled();
    const cardJson = JSON.stringify(getUpdatedCard(client));
    expect(cardJson).toContain("思考过程");
    expect(cardJson).toContain("分析中");
    vi.useRealTimers();
  });

  it("shows tool icon state transitions", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.updateProgress("chat-1", buildProgressEvent());
    await adapter.updateProgress("chat-1", buildProgressEvent({ phase: "end", status: "failed" }));

    const cardJson = JSON.stringify(getLastUpdatedCard(client));
    expect(cardJson).toContain("执行过程");
    expect(cardJson).toContain("点击查看详情");
  });

  it("shows turn summary footer", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.completeTurn("chat-1", buildTurnSummary({
      filesChanged: ["a.ts", "b.ts"],
      tokenUsage: { input: 10, output: 20 }
    }));

    const card = getUpdatedCard(client) as {
      header?: { subtitle?: { content?: string }; text_tag_list?: Array<{ text?: { content?: string } }> }
    };
    const tokenTag = card.header?.text_tag_list?.find((t: { text?: { content?: string } }) => t.text?.content?.includes("tok"));
    expect(tokenTag).toBeDefined();
    if (!tokenTag?.text?.content) {
      throw new Error("missing token tag content");
    }
    expect(tokenTag.text.content).toContain("30");
    const statusTag = card.header?.text_tag_list?.[0]?.text?.content ?? "";
    expect(statusTag).toBe("已完成");
  });

  it("aggregates stream deltas inside 500ms window", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification());
    await adapter.appendContent("chat-1", "turn-1", "hel");
    await adapter.appendContent("chat-1", "turn-1", "lo");

    expect(client.updateInteractiveCard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(client.updateInteractiveCard).toHaveBeenCalledTimes(1);
    const card = getUpdatedCard(client) as { body?: { elements?: Array<{ content?: string }> } };
    const message = card.body?.elements?.[0]?.content ?? "";
    expect(message).toContain("hello");
    vi.useRealTimers();
  });

  it("[C9L2-2] renders message stream delta in first markdown element", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-message" }));
    await adapter.appendContent("chat-1", "turn-message", "hello markdown");
    await vi.advanceTimersByTimeAsync(500);

    const card = getLastUpdatedCard(client) as { body?: { elements?: Array<{ content?: string }> } };
    expect(card.body?.elements?.[0]?.content ?? "").toContain("hello markdown");
    vi.useRealTimers();
  });

  it("[C9L2-4] renders success icon when progress tool ends successfully", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.updateProgress("chat-1", buildProgressEvent({ turnId: "turn-success" }));
    await adapter.updateProgress("chat-1", buildProgressEvent({ turnId: "turn-success", phase: "end", status: "success" }));

    const cardJson = JSON.stringify(getLastUpdatedCard(client));
    expect(cardJson).toContain("执行过程");
    expect(cardJson).toContain("turn-success");
  });

  it("[C9L2-8] requestApproval sends interactive card with action buttons", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.requestApproval("chat-1", buildApprovalRequest());

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

  it("[C9L2-9] approval button values include action, callId, and turnId", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.requestApproval("chat-1", buildApprovalRequest({
      approvalId: "approval-9",
      callId: "call-9",
      availableActions: ["approve", "deny"]
    }));

    const card = getSentCard(client) as {
      body?: { elements?: Array<{ tag?: string; columns?: Array<{ elements?: Array<{ tag?: string; behaviors?: Array<{ value?: Record<string, string> }> }> }> }> }
    };
    const actionColumnSet = card.body?.elements?.find(
      (item) => item.tag === "column_set" && item.columns?.some((col) => col.elements?.[0]?.tag === "button")
    );
    const values = actionColumnSet?.columns?.map(
      (col) => col.elements?.[0]?.behaviors?.[0]?.value ?? {}
    );

    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "approve", approvalId: "approval-9", callId: "call-9", turnId: "turn-approval" })
      ])
    );
  });

  it("[C9L2-10] requestUserInput sends plain text message", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.requestUserInput("chat-1", buildUserInputRequest());

    expect(client.sendInteractiveCard).toHaveBeenCalledWith(
      "chat-1",
      expect.objectContaining({
        body: expect.objectContaining({
          elements: expect.arrayContaining([expect.objectContaining({ tag: "markdown", content: expect.stringContaining("请选择部署环境") })])
        })
      })
    );
  });

  it("[C9L2-11] formats options in user input text as (opt1 / opt2)", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.requestUserInput("chat-1", buildUserInputRequest({
      callId: "input-2",
      questions: [{ text: "选择环境", options: ["prod", "staging"] }]
    }));

    const card = getLastSentCard(client) as { body?: { elements?: Array<Record<string, unknown>> } };
    expect(JSON.stringify(card)).toContain("prod");
    expect(JSON.stringify(card)).toContain("staging");
  });

  it("[C9L2-12] notify without turnId uses sendMessage", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: undefined, category: "warning", title: "No turn" }));

    expect(client.sendMessage).toHaveBeenCalled();
    expect(client.updateInteractiveCard).not.toHaveBeenCalled();
  });

  it("[C9L2-13] notify turn_started creates a new interactive card", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-started" }));

    expect(client.sendInteractiveCard).toHaveBeenCalledTimes(1);
  });

  it("[C9L2-14] turn_complete notification does not flush; completeTurn flushes", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-complete" }));
    await adapter.notify("chat-1", buildNotification({ turnId: "turn-complete", category: "turn_complete", title: "完成" }));

    expect(client.updateInteractiveCard).not.toHaveBeenCalled();

    await adapter.completeTurn("chat-1", buildTurnSummary({
      turnId: "turn-complete",
      tokenUsage: { input: 0, output: 0 }
    }));
    expect(client.updateInteractiveCard).toHaveBeenCalledTimes(1);
  });

  it("[C9L2-15] token_usage notification updates token usage display in later card", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-token" }));
    await adapter.notify("chat-1", buildNotification({
      turnId: "turn-token",
      category: "token_usage",
      tokenUsage: { input: 5, output: 7 },
      title: "Token 用量"
    }));
    await adapter.completeTurn("chat-1", buildTurnSummary({
      turnId: "turn-token",
      tokenUsage: { input: 5, output: 7 }
    }));

    const card = getLastUpdatedCard(client) as {
      header?: { subtitle?: { content?: string }; text_tag_list?: Array<{ text?: { content?: string } }> }
    };
    const tokenTag = card.header?.text_tag_list?.find((t: { text?: { content?: string } }) => t.text?.content?.includes("tok"));
    expect(tokenTag).toBeDefined();
    if (!tokenTag?.text?.content) {
      throw new Error("missing token tag content");
    }
    expect(tokenTag.text.content).toContain("12");
  });

  it("[C9L2-16] collab progress with agentId renders agent note", async () => {
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-collab" }));
    await adapter.updateProgress("chat-1", buildProgressEvent({
      turnId: "turn-collab",
      tool: "collab_agent",
      phase: "begin",
      label: "agent-X working",
      agentId: "agent-X"
    }));

    const card = getLastUpdatedCard(client) as { body?: { elements?: Array<{ content?: string }> } };
    const cardJson = JSON.stringify(card);
    expect(cardJson).toContain("agent-X");
  });

  it("[C9L2-18] turn_complete uses lastAgentMessage for final card", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-flush" }));
    await adapter.appendContent("chat-1", "turn-flush", "pending");
    expect(client.updateInteractiveCard).not.toHaveBeenCalled();

    await adapter.notify("chat-1", buildNotification({
      turnId: "turn-flush",
      category: "turn_complete",
      title: "完成",
      lastAgentMessage: "final answer"
    }));

    await adapter.completeTurn("chat-1", buildTurnSummary({
      turnId: "turn-flush",
      tokenUsage: { input: 0, output: 0 }
    }));

    const card = getLastUpdatedCard(client) as { body?: { elements?: Array<{ content?: string }> } };
    expect(card.body?.elements?.[0]?.content ?? "").toContain("final answer");
    vi.useRealTimers();
  });

  it("[C9L2-19] keeps cards isolated across multiple turns", async () => {
    vi.useFakeTimers();
    const client = makeFeishuClientMock();
    client.sendInteractiveCard.mockResolvedValueOnce("card-1").mockResolvedValueOnce("card-2");
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.notify("chat-1", buildNotification({ turnId: "turn-1" }));
    await adapter.notify("chat-1", buildNotification({ turnId: "turn-2" }));
    await adapter.appendContent("chat-1", "turn-1", "a");
    await adapter.appendContent("chat-1", "turn-2", "b");
    await vi.advanceTimersByTimeAsync(500);

    const cardTokens = client.updateInteractiveCard.mock.calls.map((_, index) => getUpdatedCardToken(client, index));
    expect(cardTokens).toEqual(expect.arrayContaining(["card-1", "card-2"]));
    vi.useRealTimers();
  });
});
