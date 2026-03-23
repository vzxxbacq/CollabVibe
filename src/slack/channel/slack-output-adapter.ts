// ─────────────────────────────────────────────────────────────────────────────
// SlackOutputAdapter — Slack 渠道 IMOutputAdapter 实现
// ─────────────────────────────────────────────────────────────────────────────
//
// 将 Codex 事件映射为 Slack Block Kit 消息和流式输出。
// Slack 侧未维护 L1 时间窗口 buffer；流式节流由 L2 EventPipeline/Coordinator 统一负责。
//
// 关键设计决策:
//   1. 流式内容使用 Slack 原生 Stream API (chat.startStream/appendStream/stopStream)
//      无需 StreamAggregator 的 500ms 轮询方案
//   2. 工具输出和审批请求作为 Thread 回复发送，主频道保持简洁
//   3. 轻量通知 (token_usage 等) 使用 emoji reaction
//   4. 主消息在 completeTurn 时通过 chat.update 渲染最终 blocks
// ─────────────────────────────────────────────────────────────────────────────

import type {
    IMApprovalRequest,
    IMConfigOperation,
    IMFileMergeReview,
    IMMergeSummary,
    IMNotification,
    IMPlanUpdate,
    IMProgressEvent,
    IMSkillOperation,
    IMThreadNewFormData,
    IMThreadMergeOperation,
    IMThreadOperation,
    IMToolOutputChunk,
    IMTurnSummary,
    IMUserInputRequest,
    IMSnapshotOperation
} from "../../../services/index";
import { getApprovalSummary } from "../../common/approval-display";

import type { SlackBlock, SlackMessageClient } from "./slack-message-client";
import {
    actions,
    type ProgressEntry,
    applyProgressEvent,
    buildApprovalBlocks,
    buildCompletedActions,
    buildDiffBlocks,
    buildNotificationBlocks,
    buildProgressBlocks,
    buildRunningActions,
    buildSummaryBlocks,
    buildUserInputBlocks,
    codeBlock,
    context,
    divider,
    section
} from "./slack-block-builder";

// ── 内部状态 ─────────────────────────────────────────────────────────────────

interface SlackTurnState {
    chatId: string;
    turnId: string;

    /** 主消息 ts (用于 chat.update) */
    messageTs: string | null;

    /** 当前活跃 stream ID */
    activeStreamId: string | null;

    /** 流式内容完整文本 (用于 stopStream 后 chat.update) */
    contentBuffer: string;

    /** 推理/思考缓冲 (折叠显示) */
    reasoningBuffer: string;

    /** 执行计划缓冲 */
    planBuffer: string;

    /** 工具进度条目 */
    progressEntries: ProgressEntry[];

    /** 文件变更 */
    fileChanges: Array<{
        files: string[];
        diffSummary: string;
        stats?: { additions: number; deletions: number };
    }>;

    /** Token 用量 */
    tokenUsage?: { input: number; output: number };

    /** Last agent message */
    lastAgentMessage?: string;

    /** 已执行的操作 */
    actionTaken?: "accepted" | "reverted" | "interrupted";

    /** Thread parent ts — 审批、工具输出作为 thread 回复 */
    threadTs?: string;
}

function turnKey(chatId: string, turnId: string): string {
    return `${chatId}:${turnId}`;
}

// ── SlackOutputAdapter ──────────────────────────────────────────────────────

export class SlackOutputAdapter {
    private readonly turnState = new Map<string, SlackTurnState>();
    onTurnComplete?: (chatId: string, summary: IMTurnSummary) => void;

    constructor(private readonly client: SlackMessageClient) { }

    // ── 状态管理 ────────────────────────────────────────────────────────────

    private getOrCreateState(chatId: string, turnId: string): SlackTurnState {
        const key = turnKey(chatId, turnId);
        let state = this.turnState.get(key);
        if (!state) {
            state = {
                chatId,
                turnId,
                messageTs: null,
                activeStreamId: null,
                contentBuffer: "",
                reasoningBuffer: "",
                planBuffer: "",
                progressEntries: [],
                fileChanges: []
            };
            this.turnState.set(key, state);
        }
        return state;
    }

    private cleanupTurn(chatId: string, turnId: string): void {
        const key = turnKey(chatId, turnId);
        this.turnState.delete(key);
    }

    private async postBlocks(chatId: string, blocks: SlackBlock[], text: string, threadTs?: string): Promise<void> {
        await this.client.postMessage({
            channel: chatId,
            blocks: blocks.slice(0, 50),
            text,
            threadTs
        });
    }

    // ── 流式控制 ────────────────────────────────────────────────────────────

    /**
     * 确保 stream 已启动。返回 streamId。
     * 首次调用时 startStream 创建消息并记录 messageTs。
     */
    private async ensureStream(state: SlackTurnState): Promise<string> {
        if (state.activeStreamId) {
            return state.activeStreamId;
        }

        const result = await this.client.startStream({
            channel: state.chatId,
            threadTs: state.threadTs
        });

        state.activeStreamId = result.streamId;
        state.messageTs = result.ts;
        return result.streamId;
    }

    /**
     * 结束流式，将主消息更新为最终 blocks。
     */
    private async finalizeStream(state: SlackTurnState): Promise<void> {
        if (state.activeStreamId) {
            await this.client.stopStream(state.activeStreamId);
            state.activeStreamId = null;
        }
    }

    // ── IMOutputAdapter 实现 ───────────────────────────────────────────────

    /**
     * 追加 Agent 最终回复内容。
     * 使用 Slack 原生 Stream API 实时推送 markdown 增量。
     */
    async appendContent(chatId: string, turnId: string, delta: string): Promise<void> {
        const state = this.getOrCreateState(chatId, turnId);
        state.contentBuffer += delta;

        const streamId = await this.ensureStream(state);
        await this.client.appendStream(streamId, delta);
    }

    /**
     * 追加推理/思考过程。
     * 缓冲内容，在 completeTurn 时以折叠 context 块显示。
     */
    async appendReasoning(chatId: string, turnId: string, delta: string): Promise<void> {
        const state = this.getOrCreateState(chatId, turnId);
        state.reasoningBuffer += delta;
        // 不立即显示 — CoT 在完成时折叠展示
    }

    /**
     * 追加执行计划。
     * 缓冲内容，在 completeTurn 时展示为 numbered list。
     */
    async appendPlan(chatId: string, turnId: string, delta: string): Promise<void> {
        const state = this.getOrCreateState(chatId, turnId);
        state.planBuffer += delta;
        // 在 completeTurn 时渲染
    }

    async updatePlan(chatId: string, update: IMPlanUpdate): Promise<void> {
        const state = this.getOrCreateState(chatId, update.turnId);
        const lines = update.plan.map((item) => {
            const prefix = item.status === "completed" ? "✓" : item.status === "in_progress" ? "→" : "•";
            return `${prefix} ${item.step}`;
        });
        state.planBuffer = [update.explanation, ...lines].filter(Boolean).join("\n");
    }

    /**
     * 追加工具命令输出。
     * 作为 thread 回复发送，使用 rich_text_preformatted 代码块。
     */
    async appendToolOutput(chatId: string, chunk: IMToolOutputChunk): Promise<void> {
        const state = this.getOrCreateState(chatId, chunk.turnId);

        // 确保主消息存在 (用作 thread parent)
        if (!state.messageTs) {
            await this.ensureStream(state);
        }

        // 发送到 thread
        await this.client.postMessage({
            channel: chatId,
            blocks: [
                context(`🖥️ *Command Output* (${chunk.source})`),
                codeBlock(chunk.delta)
            ],
            text: `Command output: ${chunk.delta.slice(0, 100)}`,
            threadTs: state.messageTs ?? undefined
        });
    }

    /**
     * 更新工具执行进度。
     * 更新状态，通过 chat.update 刷新主消息的进度区域。
     */
    async updateProgress(chatId: string, event: IMProgressEvent): Promise<void> {
        const state = this.getOrCreateState(chatId, event.turnId);
        state.progressEntries = applyProgressEvent(state.progressEntries, event);

        // 如果有 agentId，记录 agent note
        if (event.agentId) {
            state.lastAgentMessage = `🤖 Agent ${event.agentId}: ${event.label}`;
        }

        // 如果主消息已存在，更新进度显示
        if (state.messageTs) {
            const blocks = this.buildTurnBlocks(state, false);
            await this.client.updateMessage({
                channel: chatId,
                ts: state.messageTs,
                blocks,
                text: `Progress: ${event.label}`
            });
        }
    }

    /**
     * 发送审批请求。
     * 独立消息或 thread 回复，带按钮组。
     */
    async requestApproval(chatId: string, req: IMApprovalRequest): Promise<void> {
        const state = this.getOrCreateState(chatId, req.turnId);
        const blocks = buildApprovalBlocks(req);
        const summary = getApprovalSummary(req) || req.description;

        await this.client.postMessage({
            channel: chatId,
            blocks,
            text: `Approval required: ${summary}`,
            threadTs: state.messageTs ?? undefined
        });
    }

    /**
     * 发送用户输入请求。
     * Thread 回复，纯文本问题。
     */
    async requestUserInput(chatId: string, req: IMUserInputRequest): Promise<void> {
        const state = this.getOrCreateState(chatId, req.turnId);
        const blocks = buildUserInputBlocks(req);

        await this.client.postMessage({
            channel: chatId,
            blocks,
            text: req.questions.map((q) => q.text).join("\n"),
            threadTs: state.messageTs ?? undefined
        });
    }

    /**
     * Turn 完成汇总。
     * 1. 结束 stream
     * 2. chat.update 渲染最终 blocks (内容 + 进度 + diff + 摘要 + 操作按钮)
     */
    async completeTurn(chatId: string, summary: IMTurnSummary): Promise<void> {
        const state = this.getOrCreateState(chatId, summary.turnId);
        state.tokenUsage = summary.tokenUsage;

        if (summary.lastAgentMessage) {
            state.lastAgentMessage = summary.lastAgentMessage;
            state.contentBuffer = summary.lastAgentMessage;
        }

        // 结束流式
        await this.finalizeStream(state);

        // 渲染最终 blocks
        const blocks = this.buildTurnBlocks(state, true);

        if (state.messageTs) {
            await this.client.updateMessage({
                channel: chatId,
                ts: state.messageTs,
                blocks,
                text: state.contentBuffer.slice(0, 200) || "Turn completed"
            });
        } else {
            // 无主消息 — 发送新消息
            const result = await this.client.postMessage({
                channel: chatId,
                blocks,
                text: state.contentBuffer.slice(0, 200) || "Turn completed"
            });
            state.messageTs = result.ts;
        }

        this.onTurnComplete?.(chatId, summary);
    }

    /**
     * 系统通知。
     * - turn_started: 初始化状态 (stream 在 appendContent 时启动)
     * - turn_complete: 更新 lastAgentMessage
     * - token_usage: emoji reaction
     * - error/warning: 独立消息
     */
    async notify(chatId: string, notif: IMNotification): Promise<void> {
        const turnId = notif.turnId;

        if (notif.category === "turn_started" && turnId) {
            // 初始化状态
            this.getOrCreateState(chatId, turnId);
            return;
        }

        if (notif.category === "turn_complete" && turnId) {
            const state = this.turnState.get(turnKey(chatId, turnId));
            if (state && notif.lastAgentMessage) {
                state.lastAgentMessage = notif.lastAgentMessage;
                state.contentBuffer = notif.lastAgentMessage;
            }
            return;
        }

        if (notif.category === "token_usage" && turnId) {
            const state = this.turnState.get(turnKey(chatId, turnId));
            if (state) {
                state.tokenUsage = notif.tokenUsage;
            }
            // 轻量通知 — 使用 reaction 代替消息
            if (state?.messageTs) {
                await this.client.addReaction(chatId, state.messageTs, "zap").catch(() => { });
            }
            return;
        }

        if (notif.category === "error" || notif.category === "warning") {
            const blocks = buildNotificationBlocks(notif.category, notif.title, notif.detail);
            await this.client.postMessage({
                channel: chatId,
                blocks,
                text: `${notif.category}: ${notif.title}`
            });
            return;
        }

        // 其他通知类型 — 静默处理或 log
    }

    // ── 操作回调 ────────────────────────────────────────────────────────────

    /**
     * 处理用户操作 (approve / revert / interrupt)。
     * 更新主消息，移除按钮，显示操作结果。
     */
    async updateCardAction(
        chatId: string,
        turnId: string,
        action: "accepted" | "reverted" | "interrupted"
    ): Promise<void> {
        const state = this.turnState.get(turnKey(chatId, turnId));
        if (!state || !state.messageTs) return;

        state.actionTaken = action;

        const blocks = this.buildTurnBlocks(state, true);
        await this.client.updateMessage({
            channel: chatId,
            ts: state.messageTs,
            blocks,
            text: `Action: ${action}`
        });

        // 清理状态
        this.cleanupTurn(chatId, turnId);
    }

    // ── Block 构建 ─────────────────────────────────────────────────────────

    /**
     * 构建完整的 turn blocks (用于 chat.update)。
     */
    private buildTurnBlocks(state: SlackTurnState, isDone: boolean): SlackBlock[] {
        const blocks: SlackBlock[] = [];

        // 主内容
        if (state.contentBuffer) {
            blocks.push(section(state.contentBuffer));
        } else if (!isDone) {
            blocks.push(section("_Waiting for output..._"));
        }

        // 计划 (如果有)
        if (state.planBuffer) {
            blocks.push(divider());
            blocks.push(section(`📋 *Plan*\n${state.planBuffer}`));
        }

        // 进度
        blocks.push(...buildProgressBlocks(state.progressEntries));

        // 文件变更
        for (const fc of state.fileChanges.slice(-3)) {
            blocks.push(...buildDiffBlocks(fc.diffSummary, fc.files, fc.stats));
        }

        // 摘要 (完成时)
        if (isDone) {
            blocks.push(...buildSummaryBlocks({
                kind: "turn_summary",
                threadId: "",
                turnId: state.turnId,
                filesChanged: state.fileChanges.flatMap((fc) => fc.files),
                tokenUsage: state.tokenUsage
            }));
        }

        // 操作按钮
        if (state.actionTaken) {
            const label = state.actionTaken === "accepted" ? "✅ Approved"
                : state.actionTaken === "reverted" ? "↩️ Reverted"
                    : "🛑 Interrupted";
            blocks.push(divider());
            blocks.push(context(label));
        } else if (isDone) {
            blocks.push(...buildCompletedActions(state.chatId, state.turnId));
        } else {
            blocks.push(...buildRunningActions(state.chatId, state.turnId));
        }

        // Block Kit 限制: 最多 50 blocks
        return blocks.slice(0, 50);
    }

    async sendThreadOperation(chatId: string, op: IMThreadOperation): Promise<void> {
        if (op.action === "listed") {
            const threads = op.threads ?? [];
            if (threads.length === 0) {
                await this.client.postMessage({
                    channel: chatId,
                    blocks: [section("📋 No threads yet. Use `/thread new <name>` to create one.")],
                    text: "No threads"
                });
                return;
            }
            const threadBlocks: SlackBlock[] = [
                section(`📋 *${threads.length} Thread${threads.length > 1 ? "s" : ""}*`),
                divider()
            ];
            for (const t of threads) {
                const active = t.active ? " 🟢" : "";
                const statusLine = t.status === "creating"
                    ? `creating${t.backendName ? ` · ${t.backendName}` : ""}${t.modelName ? ` / ${t.modelName}` : ""}`
                    : `\`${(t.threadId ?? "").slice(0, 8)}\``;
                threadBlocks.push(section(`*${t.threadName}*${active}\n${statusLine}`));
            }
            threadBlocks.push(divider());
            threadBlocks.push(context("Use `/thread join <name>` or `/thread resume <name>` to switch"));
            await this.client.postMessage({
                channel: chatId,
                blocks: threadBlocks.slice(0, 50),
                text: `${threads.length} threads available`
            });
            return;
        }

        if (op.action === "created" && op.thread) {
            await this.client.postMessage({
                channel: chatId,
                blocks: [section(`✅ Thread created: *${op.thread.threadName}*\nID: \`${op.thread.threadId.slice(0, 8)}\``)],
                text: `Thread created: ${op.thread.threadName}`
            });
            return;
        }

        if ((op.action === "joined" || op.action === "resumed") && op.thread) {
            await this.client.postMessage({
                channel: chatId,
                blocks: [section(`🔄 Switched to: *${op.thread.threadName}*`)],
                text: `Switched to: ${op.thread.threadName}`
            });
            return;
        }

        if (op.action === "left") {
            await this.client.postMessage({
                channel: chatId,
                blocks: [section("👋 Left current thread")],
                text: "Left current thread"
            });
        }
    }

    async sendSnapshotOperation(_chatId: string, _op: IMSnapshotOperation, _userId?: string): Promise<void> {
        if (_op.action === "listed") {
            const snapshots = _op.snapshots ?? [];
            if (snapshots.length === 0) {
                await this.postBlocks(_chatId, [section("📚 No snapshots available.")], "No snapshots");
                return;
            }
            const blocks: SlackBlock[] = [
                section(`📚 *Snapshots · ${_op.threadName ?? _op.threadId ?? "main"}*`),
                divider()
            ];
            for (const snapshot of snapshots.slice(-10).reverse()) {
                const current = snapshot.isCurrent ? " 🟢 current" : "";
                const summary = snapshot.agentSummary ? `\n${snapshot.agentSummary}` : "";
                const files = snapshot.filesChanged?.length ? `\nFiles: ${snapshot.filesChanged.join(", ")}` : "";
                blocks.push(section(`*#${snapshot.turnIndex}* \`${snapshot.turnId.slice(0, 8)}\`${current}\n${snapshot.createdAt}${summary}${files}`));
            }
            await this.postBlocks(_chatId, blocks, `Snapshots for ${_op.threadName ?? _op.threadId ?? "main"}`);
            return;
        }

        if (_op.action === "jumped" && _op.target) {
            const contextReset = _op.contextReset ? "\nContext was reset for this jump." : "";
            await this.postBlocks(
                _chatId,
                [section(`⏪ Jumped to snapshot *#${_op.target.turnIndex}* \`${_op.target.turnId.slice(0, 8)}\`${contextReset}`)],
                `Jumped to snapshot ${_op.target.turnId}`
            );
        }
    }

    async sendConfigOperation(chatId: string, op: IMConfigOperation, _userId?: string): Promise<void> {
        if (op.action === "model_set") {
            await this.postBlocks(
                chatId,
                [section(`⚙️ Model set to *${op.currentModel ?? "unknown"}*${op.threadName ? ` for \`${op.threadName}\`` : ""}`)],
                `Model set: ${op.currentModel ?? "unknown"}`
            );
            return;
        }

        const availableModels = op.availableModels ?? [];
        const lines = availableModels.length > 0
            ? availableModels.map((model) => model === op.currentModel ? `• *${model}*` : `• ${model}`).join("\n")
            : "_No models reported by backend._";
        await this.postBlocks(
            chatId,
            [section(`⚙️ *Models*${op.threadName ? ` · \`${op.threadName}\`` : ""}\nCurrent: *${op.currentModel ?? "unknown"}*\n${lines}`)],
            `Model list for ${op.threadName ?? "current thread"}`
        );
    }

    async sendThreadNewForm(chatId: string, data: IMThreadNewFormData): Promise<void> {
        const backendLines = data.catalog.backends.map((backend) => {
            const optionLabels = backend.options.length ? backend.options.map((option) => option.label).join(", ") : "no options";
            return `• *${backend.backendId}*${backend.backendId === data.catalog.defaultSelection?.backendId ? " (default)" : ""}: ${optionLabels}`;
        });
        await this.postBlocks(
            chatId,
            [
                section(`🧵 *Create Thread*\nDefault backend: *${data.catalog.defaultSelection?.backendId ?? "unknown"}*\nDefault model: *${data.catalog.defaultSelection?.model ?? "unknown"}*`),
                divider(),
                section(backendLines.join("\n") || "_No backend available._"),
                context("Use the platform command path to create a thread until Slack interactive form submission is wired.")
            ],
            "Create thread"
        );
    }

    async sendMergeOperation(chatId: string, op: IMThreadMergeOperation): Promise<void> {
        if (op.action === "preview") {
            const fileList = op.diffStats?.filesChanged ?? [];
            const statsText = op.diffStats
                ? `+${op.diffStats.additions} / -${op.diffStats.deletions}`
                : "";
            const blocks: SlackBlock[] = [
                section(`🔀 *Merge Preview: ${op.branchName} → main*\n${fileList.length} files  ${statsText}`),
                divider(),
                section(fileList.length > 0
                    ? fileList.map(f => `• ${f}`).join("\n")
                    : "_(no file changes)_"),
                divider(),
                context("⚠️ Merging to main is sensitive. Please review before approving."),
                actions(`merge_preview_${op.branchName}`, [
                    {
                        text: "✅ Confirm Merge",
                        actionId: "codex_merge_confirm",
                        value: JSON.stringify({ action: "confirm_merge", branchName: op.branchName, baseBranch: op.baseBranch }),
                        style: "primary"
                    },
                    {
                        text: "🚫 Cancel",
                        actionId: "codex_merge_cancel_preview",
                        value: JSON.stringify({ action: "cancel_merge", branchName: op.branchName, baseBranch: op.baseBranch }),
                        style: "danger"
                    }
                ])
            ];
            await this.client.postMessage({
                channel: chatId,
                blocks: blocks.slice(0, 50),
                text: `Merge preview: ${op.branchName} → main`
            });
            return;
        }

        if (op.action === "conflict") {
            const conflicts = op.conflicts ?? [];
            const resolverInfo = op.resolverThread
                ? `\n🤖 Created resolver thread: *${op.resolverThread.threadName}*\nAgent will auto-resolve conflicts (each file change requires approval)`
                : `\nUse \`/merge ${op.branchName} --force\` to force merge (branch overwrites main)`;
            await this.client.postMessage({
                channel: chatId,
                blocks: [
                    section(`⚠️ *Merge Conflict: ${op.branchName}*\n${conflicts.length} file(s) with conflicts`),
                    divider(),
                    section(conflicts.map(f => `• ⚠️ ${f}`).join("\n") + resolverInfo)
                ],
                text: `Merge conflict: ${op.branchName}`
            });
            return;
        }

        if (op.action === "success") {
            await this.client.postMessage({
                channel: chatId,
                blocks: [section(`✅ *${op.branchName}* successfully merged to main`)],
                text: `Merged: ${op.branchName} → main`
            });
            return;
        }

        if (op.action === "rejected") {
            await this.client.postMessage({
                channel: chatId,
                blocks: [section(`🚫 Merge of *${op.branchName}* cancelled`)],
                text: `Merge cancelled: ${op.branchName}`
            });
        }
    }

    async sendFileReview(chatId: string, review: IMFileMergeReview): Promise<void> {
        const available = review.availableDecisions.map((item) => `\`${item}\``).join(", ");
        const queues = [
            review.queues.conflictPaths.length ? `Conflicts: ${review.queues.conflictPaths.join(", ")}` : "",
            review.queues.directPaths.length ? `Direct: ${review.queues.directPaths.join(", ")}` : "",
            review.queues.agentPendingPaths.length ? `Agent pending: ${review.queues.agentPendingPaths.join(", ")}` : ""
        ].filter(Boolean).join("\n");
        await this.postBlocks(
            chatId,
            [
                section(`🧾 *Merge Review ${review.fileIndex + 1}/${review.totalFiles}*\nFile: \`${review.file.path}\`\nStatus: *${review.file.status}*`),
                codeBlock(review.file.diff.slice(0, 2500)),
                divider(),
                section(`Available decisions: ${available}\nAccepted: ${review.progress.accepted} · Rejected: ${review.progress.rejected} · Remaining: ${review.progress.remaining}`),
                ...(queues ? [context(queues)] : []),
                actions(`merge_review_${review.branchName}_${review.fileIndex}`, [
                    ...(review.availableDecisions.includes("accept") ? [{
                        text: "✅ Accept",
                        actionId: "codex_merge_accept",
                        value: JSON.stringify({ action: "merge_accept", branchName: review.branchName, filePath: review.file.path }),
                        style: "primary" as const
                    }] : []),
                    ...(review.availableDecisions.includes("keep_main") ? [{
                        text: "📍 Keep Main",
                        actionId: "codex_merge_keep_main",
                        value: JSON.stringify({ action: "merge_keep_main", branchName: review.branchName, filePath: review.file.path })
                    }] : []),
                    ...(review.availableDecisions.includes("use_branch") ? [{
                        text: "🌿 Use Branch",
                        actionId: "codex_merge_use_branch",
                        value: JSON.stringify({ action: "merge_use_branch", branchName: review.branchName, filePath: review.file.path })
                    }] : []),
                    ...(review.availableDecisions.includes("skip") ? [{
                        text: "⏭️ Skip",
                        actionId: "codex_merge_skip",
                        value: JSON.stringify({ action: "merge_skip", branchName: review.branchName, filePath: review.file.path })
                    }] : [])
                ]),
                actions(`merge_review_all_${review.branchName}`, [
                    {
                        text: "✅ Accept All",
                        actionId: "codex_merge_accept_all",
                        value: JSON.stringify({ action: "merge_accept_all", branchName: review.branchName }),
                        style: "primary"
                    },
                    {
                        text: "🤖 Agent Assist",
                        actionId: "codex_merge_agent",
                        value: JSON.stringify({ action: "merge_agent_assist_submit", branchName: review.branchName })
                    },
                    {
                        text: "🚫 Cancel",
                        actionId: "codex_merge_cancel",
                        value: JSON.stringify({ action: "merge_cancel", branchName: review.branchName, baseBranch: review.baseBranch }),
                        style: "danger"
                    }
                ])
            ],
            `Merge review: ${review.file.path}`
        );
    }

    async sendMergeSummary(chatId: string, summary: IMMergeSummary): Promise<void> {
        const lines = summary.files.slice(0, 20).map((item) => `• \`${item.path}\` → *${item.decision}* (${item.status})`);
        if (summary.files.length > 20) {
            lines.push(`… ${summary.files.length - 20} more file(s)`);
        }
        await this.postBlocks(
            chatId,
            [
                section(`📦 *Merge Summary: ${summary.branchName} → ${summary.baseBranch}*`),
                divider(),
                section(lines.join("\n") || "_No files in summary._"),
                context(summary.hasPartialMerge ? "Partial merge decisions present." : "All files accepted."),
                actions(`merge_summary_${summary.branchName}`, [
                    {
                        text: "✅ Commit Merge",
                        actionId: "codex_merge_commit",
                        value: JSON.stringify({ action: "merge_commit", branchName: summary.branchName, baseBranch: summary.baseBranch }),
                        style: "primary"
                    },
                    {
                        text: "🚫 Cancel",
                        actionId: "codex_merge_cancel",
                        value: JSON.stringify({ action: "merge_cancel", branchName: summary.branchName, baseBranch: summary.baseBranch }),
                        style: "danger"
                    }
                ])
            ],
            `Merge summary: ${summary.branchName}`
        );
    }

    async sendSkillOperation(chatId: string, op: IMSkillOperation): Promise<void> {
        if (op.action === "form") {
            const skills = op.skills ?? [];
            const lines = skills.length > 0
                ? skills.map((skill) => `• *${skill.name}*${skill.installed ? " (installed)" : ""}\n${skill.description || "_No description_"}`).join("\n")
                : "_No installable skills available._";
            await this.postBlocks(chatId, [section(`🧩 *Skills*\n${lines}`)], "Skill list");
            return;
        }

        if (op.action === "installed" && op.skill) {
            await this.postBlocks(chatId, [section(`✅ Skill installed: *${op.skill.name}*`)], `Skill installed: ${op.skill.name}`);
            return;
        }

        if (op.action === "removed" && op.skill) {
            await this.postBlocks(chatId, [section(`🗑️ Skill removed: *${op.skill.name}*`)], `Skill removed: ${op.skill.name}`);
            return;
        }

        if (op.action === "admin_placeholder") {
            await this.postBlocks(chatId, [section("🧩 Use `/skill list`, `/skill install <source>`, and `/skill remove <name>` to manage skills on Slack.")], "Slack admin skill panel");
            return;
        }

        await this.postBlocks(chatId, [section(`⚠️ Skill operation failed\n${op.error ?? "Unknown error"}`)], "Skill operation error");
    }
}
