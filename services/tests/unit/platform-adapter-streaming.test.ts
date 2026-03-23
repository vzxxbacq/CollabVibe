import { describe, expect, it } from "vitest";

import type { IMTurnSummary } from "../../index";
import { FeishuOutputAdapter } from "../../../src/feishu/channel/feishu-output-adapter";
import { SlackOutputAdapter } from "../../../src/slack/channel/slack-output-adapter";
import type { SlackBlock, SlackMessageClient } from "../../../src/slack/channel/slack-message-client";

class FakeFeishuClient {
  createdCardEntities: Record<string, unknown>[] = [];
  sendMessages: Array<{ chatId: string; text?: string }> = [];
  sentCards: Array<{ chatId: string; card: Record<string, unknown> }> = [];
  updatedCards: Array<{ cardToken: string; card: Record<string, unknown> }> = [];
  streamedElements: Array<{ cardId: string; elementId: string; content: string; sequence: number }> = [];
  cardSettings: Array<{ cardId: string; settings: Record<string, unknown>; sequence: number }> = [];
  elementUpdates: Array<{ cardId: string; elementId: string; element: Record<string, unknown>; sequence: number }> = [];

  async sendMessage(input: { chatId: string; text?: string }): Promise<string> {
    this.sendMessages.push(input);
    return `msg-${this.sendMessages.length}`;
  }

  async sendInteractiveCard(chatId: string, card: Record<string, unknown>): Promise<string> {
    this.sentCards.push({ chatId, card });
    return `card-msg-${this.sentCards.length}`;
  }

  async updateInteractiveCard(cardToken: string, card: Record<string, unknown>): Promise<void> {
    this.updatedCards.push({ cardToken, card });
  }

  async createCardEntity(card: Record<string, unknown>): Promise<string> {
    this.createdCardEntities.push(card);
    return "card-1";
  }

  async sendCardEntity(_chatId: string, _cardId: string): Promise<string> {
    return "msg-1";
  }

  async updateCardSettings(cardId: string, settings: Record<string, unknown>, sequence: number): Promise<void> {
    this.cardSettings.push({ cardId, settings, sequence });
  }

  async streamCardElement(cardId: string, elementId: string, content: string, sequence: number): Promise<void> {
    this.streamedElements.push({ cardId, elementId, content, sequence });
  }

  async updateCardElement(cardId: string, elementId: string, element: Record<string, unknown>, sequence: number): Promise<void> {
    this.elementUpdates.push({ cardId, elementId, element, sequence });
  }
}

class FakeSlackClient implements SlackMessageClient {
  postMessages: Array<{ channel: string; blocks: SlackBlock[]; text: string; threadTs?: string }> = [];
  updatedMessages: Array<{ channel: string; ts: string; blocks: SlackBlock[]; text: string }> = [];
  streamStarts: Array<{ channel: string; threadTs?: string }> = [];
  appended: Array<{ streamId: string; markdown: string }> = [];
  stopped: Array<{ streamId: string; finalBlocks?: SlackBlock[] }> = [];

  async postMessage(params: { channel: string; blocks: SlackBlock[]; text: string; threadTs?: string }): Promise<{ ts: string; channel: string }> {
    this.postMessages.push(params);
    return { ts: `ts-${this.postMessages.length}`, channel: params.channel };
  }

  async updateMessage(params: { channel: string; ts: string; blocks: SlackBlock[]; text: string }): Promise<void> {
    this.updatedMessages.push(params);
  }

  async deleteMessage(): Promise<void> {}

  async startStream(params: { channel: string; threadTs?: string }): Promise<{ streamId: string; ts: string; channel: string }> {
    this.streamStarts.push(params);
    return { streamId: "stream-1", ts: "ts-stream-1", channel: params.channel };
  }

  async appendStream(streamId: string, markdown: string): Promise<void> {
    this.appended.push({ streamId, markdown });
  }

  async stopStream(streamId: string, finalBlocks?: SlackBlock[]): Promise<void> {
    this.stopped.push({ streamId, finalBlocks });
  }

  async addReaction(): Promise<void> {}
  async removeReaction(): Promise<void> {}
}

function summary(turnId: string, lastAgentMessage: string): IMTurnSummary {
  return {
    kind: "turn_summary",
    threadId: "thread-1",
    threadName: "main",
    turnId,
    filesChanged: [],
    lastAgentMessage,
    tokenUsage: { input: 1, output: 2, total: 3 },
    duration: 100
  };
}

describe("platform adapters consume aggregated stream output consistently", () => {
  it("Feishu native streaming pushes aggregated content/tool output once and finalizes the card", async () => {
    const client = new FakeFeishuClient();
    const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

    await adapter.appendContent("chat-1", "turn-1", "hello stream world");
    await adapter.updateProgress("chat-1", {
      kind: "progress",
      turnId: "turn-1",
      phase: "begin",
      tool: "exec_command",
      label: "cat log",
      callId: "call-1"
    });
    await adapter.appendToolOutput("chat-1", {
      kind: "tool_output",
      turnId: "turn-1",
      callId: "call-1",
      delta: "line-1\nline-2\n",
      source: "stdout"
    });
    await adapter.completeTurn("chat-1", summary("turn-1", "hello stream world"));

    const msgStream = client.streamedElements.filter((item) => item.elementId === "turn_msg");
    const toolStream = client.streamedElements.filter((item) => item.elementId === "turn_tools");

    expect(client.createdCardEntities.length).toBeGreaterThan(0);
    expect(JSON.stringify(client.createdCardEntities[0])).toContain("hello stream world");
    expect(toolStream).toHaveLength(1);
    expect(toolStream[0]?.content).toContain("line-1");
    expect(toolStream[0]?.content).toContain("line-2");
    expect(client.cardSettings.some((item) => JSON.stringify(item.settings).includes("\"streaming_mode\":false"))).toBe(true);
    expect(client.updatedCards.length).toBeGreaterThan(0);
  });

  it("Slack streaming pushes the same aggregated content/tool output shape", async () => {
    const client = new FakeSlackClient();
    const adapter = new SlackOutputAdapter(client);

    await adapter.appendContent("chat-1", "turn-1", "hello stream world");
    await adapter.updateProgress("chat-1", {
      kind: "progress",
      turnId: "turn-1",
      phase: "begin",
      tool: "exec_command",
      label: "cat log",
      callId: "call-1"
    });
    await adapter.appendToolOutput("chat-1", {
      kind: "tool_output",
      turnId: "turn-1",
      callId: "call-1",
      delta: "line-1\nline-2\n",
      source: "stdout"
    });
    await adapter.completeTurn("chat-1", summary("turn-1", "hello stream world"));

    expect(client.streamStarts).toHaveLength(1);
    expect(client.appended).toEqual([{ streamId: "stream-1", markdown: "hello stream world" }]);
    expect(client.postMessages).toHaveLength(1);
    expect(client.postMessages[0]?.text).toContain("line-1");
    expect(client.postMessages[0]?.text).toContain("line-2");
    expect(client.stopped).toHaveLength(1);
    expect(client.updatedMessages.length).toBeGreaterThan(0);
    expect(client.updatedMessages.at(-1)?.text).toContain("hello stream world");
  });
});
