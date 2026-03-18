// ─────────────────────────────────────────────────────────────────────────────
// SlackMessageClient — Slack Web API 封装层
// ─────────────────────────────────────────────────────────────────────────────
//
// 职责: 封装 Slack Web API 调用，提供类型安全的消息操作接口。
// 类似 FeishuMessageClient，但针对 Slack 的消息、流式和交互 API。
//
// 关键 API:
//   - chat.postMessage / chat.update / chat.delete
//   - chat.startStream / chat.appendStream / chat.stopStream (AI streaming)
//   - reactions.add
// ─────────────────────────────────────────────────────────────────────────────

/** Slack Block Kit block (type-safe subset) */
export type SlackBlock = Record<string, unknown>;

/** Slack message post result */
export interface SlackPostResult {
    ts: string;       // Message timestamp (unique ID)
    channel: string;
}

/** Slack stream start result */
export interface SlackStreamResult {
    streamId: string;
    ts: string;        // Message timestamp of the stream message
    channel: string;
}

/**
 * SlackMessageClient — Slack Web API 接口。
 *
 * 生产环境使用 @slack/web-api WebClient 实现，
 * 测试环境使用 mock 实现。
 */
export interface SlackMessageClient {
    // ── 消息操作 ──────────────────────────────────────────────────────────────

    /** 发送消息到 channel (或 thread) */
    postMessage(params: {
        channel: string;
        blocks: SlackBlock[];
        text: string;           // Fallback text for notifications
        threadTs?: string;      // Thread parent ts (回复到 thread)
    }): Promise<SlackPostResult>;

    /** 更新已发送的消息 */
    updateMessage(params: {
        channel: string;
        ts: string;
        blocks: SlackBlock[];
        text: string;
    }): Promise<void>;

    /** 删除消息 */
    deleteMessage(channel: string, ts: string): Promise<void>;

    // ── 流式 API (AI Streaming) ──────────────────────────────────────────────

    /** 开始一个流式消息 */
    startStream(params: {
        channel: string;
        threadTs?: string;
    }): Promise<SlackStreamResult>;

    /** 追加 markdown 内容到流式消息 */
    appendStream(streamId: string, markdown: string): Promise<void>;

    /** 结束流式消息，可选提供最终的 blocks 替换 */
    stopStream(streamId: string, finalBlocks?: SlackBlock[]): Promise<void>;

    // ── 交互 ────────────────────────────────────────────────────────────────

    /** 添加 emoji reaction */
    addReaction(channel: string, ts: string, emoji: string): Promise<void>;

    /** 移除 emoji reaction */
    removeReaction(channel: string, ts: string, emoji: string): Promise<void>;
}

// ── 实现 ──────────────────────────────────────────────────────────────────

/**
 * FetchSlackClient — 基于 fetch 的 SlackMessageClient 实现。
 *
 * 使用 Slack Web API (https://slack.com/api/xxx)。
 * 需要 Bot User OAuth Token (xoxb-...)。
 */
export class FetchSlackClient implements SlackMessageClient {
    private readonly baseUrl = "https://slack.com/api";

    constructor(private readonly botToken: string) { }

    private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
        const response = await fetch(`${this.baseUrl}/${method}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${this.botToken}`,
                "Content-Type": "application/json; charset=utf-8"
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            throw new Error(`Slack API ${method} HTTP ${response.status}`);
        }

        const data = await response.json() as { ok: boolean; error?: string; ts?: string; channel?: string; stream_id?: string };
        if (!data.ok) {
            throw new Error(`Slack API ${method} error: ${data.error ?? "unknown"}`);
        }

        return data as T;
    }

    async postMessage(params: {
        channel: string;
        blocks: SlackBlock[];
        text: string;
        threadTs?: string;
    }): Promise<SlackPostResult> {
        const body: Record<string, unknown> = {
            channel: params.channel,
            blocks: params.blocks,
            text: params.text
        };
        if (params.threadTs) {
            body.thread_ts = params.threadTs;
        }
        const result = await this.call<{ ts: string; channel: string }>("chat.postMessage", body);
        return { ts: result.ts, channel: result.channel };
    }

    async updateMessage(params: {
        channel: string;
        ts: string;
        blocks: SlackBlock[];
        text: string;
    }): Promise<void> {
        await this.call("chat.update", {
            channel: params.channel,
            ts: params.ts,
            blocks: params.blocks,
            text: params.text
        });
    }

    async deleteMessage(channel: string, ts: string): Promise<void> {
        await this.call("chat.delete", { channel, ts });
    }

    async startStream(params: {
        channel: string;
        threadTs?: string;
    }): Promise<SlackStreamResult> {
        const body: Record<string, unknown> = { channel: params.channel };
        if (params.threadTs) {
            body.thread_ts = params.threadTs;
        }
        const result = await this.call<{ stream_id: string; ts: string; channel: string }>("chat.startStream", body);
        return { streamId: result.stream_id, ts: result.ts, channel: result.channel };
    }

    async appendStream(streamId: string, markdown: string): Promise<void> {
        await this.call("chat.appendStream", { stream_id: streamId, markdown });
    }

    async stopStream(streamId: string, finalBlocks?: SlackBlock[]): Promise<void> {
        const body: Record<string, unknown> = { stream_id: streamId };
        if (finalBlocks) {
            body.blocks = finalBlocks;
        }
        await this.call("chat.stopStream", body);
    }

    async addReaction(channel: string, ts: string, emoji: string): Promise<void> {
        await this.call("reactions.add", { channel, timestamp: ts, name: emoji });
    }

    async removeReaction(channel: string, ts: string, emoji: string): Promise<void> {
        await this.call("reactions.remove", { channel, timestamp: ts, name: emoji });
    }
}
