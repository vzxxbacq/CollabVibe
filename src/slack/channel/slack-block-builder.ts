// ─────────────────────────────────────────────────────────────────────────────
// SlackBlockBuilder — Slack Block Kit JSON 构建器
// ─────────────────────────────────────────────────────────────────────────────
//
// 提供类型安全的 Block Kit 构建函数，对应 IMOutputAdapter 的各 UI 区域。
// 每个 builder 函数返回 SlackBlock[] 数组，可直接传入 postMessage/updateMessage。
// ─────────────────────────────────────────────────────────────────────────────

import type { SlackBlock } from "./slack-message-client";
import { getApprovalCwd, getApprovalDisplayName, getApprovalReason, getApprovalSummary } from "../../common/approval-display";
import type {
    IMApprovalRequest,
    IMProgressEvent,
    IMTurnSummary,
    IMUserInputRequest
} from "../../../services/index";

// ── 基础构建块 ──────────────────────────────────────────────────────────────

/** Markdown section block */
export function section(text: string): SlackBlock {
    return {
        type: "section",
        text: { type: "mrkdwn", text }
    };
}

/** Context block (small text, icons) */
export function context(...elements: Array<string | { type: string; image_url: string; alt_text: string }>): SlackBlock {
    return {
        type: "context",
        elements: elements.map((el) =>
            typeof el === "string" ? { type: "mrkdwn", text: el } : el
        )
    };
}

/** Divider (horizontal rule) */
export function divider(): SlackBlock {
    return { type: "divider" };
}

/** Header block */
export function header(text: string): SlackBlock {
    return {
        type: "header",
        text: { type: "plain_text", text, emoji: true }
    };
}

/** Actions block with buttons */
export function actions(
    blockId: string,
    buttons: Array<{
        text: string;
        actionId: string;
        value: string;
        style?: "primary" | "danger";
    }>
): SlackBlock {
    return {
        type: "actions",
        block_id: blockId,
        elements: buttons.map((btn) => ({
            type: "button",
            text: { type: "plain_text", text: btn.text, emoji: true },
            action_id: btn.actionId,
            value: btn.value,
            ...(btn.style ? { style: btn.style } : {})
        }))
    };
}

/** Rich text block with preformatted code */
export function codeBlock(code: string, language?: string): SlackBlock {
    return {
        type: "rich_text",
        elements: [
            {
                type: "rich_text_preformatted",
                ...(language ? { border: 1 } : {}),
                elements: [
                    { type: "text", text: code }
                ]
            }
        ]
    };
}

// ── UI 区域构建器 ────────────────────────────────────────────────────────────

/** 进度 icon 映射 (与 Feishu 保持一致) */
function progressIcon(event: IMProgressEvent): string {
    if (event.phase === "begin") return "🔄";
    return event.status === "failed" ? "❌" : "✅";
}

/** 工具标签 */
function toolLabel(tool: string): string {
    const labels: Record<string, string> = {
        exec_command: "🖥️",
        mcp_tool: "🔧",
        web_search: "🔍",
        image_gen: "🎨",
        patch_apply: "📝",
        collab_agent: "🤖"
    };
    return labels[tool] ?? "⚙️";
}

// ── 组合构建器 ────────────────────────────────────────────────────────────

export interface ProgressEntry {
    icon: string;
    label: string;
    tool: string;
    duration?: string;
}

/**
 * 构建进度 blocks — 显示工具执行状态列表。
 * 使用 context block 紧凑显示，最多显示最近 6 条。
 */
export function buildProgressBlocks(entries: ProgressEntry[]): SlackBlock[] {
    if (entries.length === 0) return [];

    const recent = entries.slice(-6);
    const omitted = entries.length - recent.length;
    const lines = recent.map((e) => {
        const dur = e.duration ? ` (${e.duration})` : "";
        return `${e.icon} ${toolLabel(e.tool)} ${e.label}${dur}`;
    });

    if (omitted > 0) {
        lines.unshift(`_...${omitted} items omitted_`);
    }

    return [
        divider(),
        context(`*⚙️ Progress*\n${lines.join("\n")}`)
    ];
}

/**
 * 构建审批 blocks — 描述 + 按钮组。
 */
export function buildApprovalBlocks(req: IMApprovalRequest): SlackBlock[] {
    const display = getApprovalDisplayName(req);
    const summary = getApprovalSummary(req) || "Approval required";
    const reason = getApprovalReason(req);
    const cwd = getApprovalCwd(req);
    const lines = [
        "⚠️ *Approval Required*",
        display ? `*Operation:* ${display}` : undefined,
        `*Summary:* ${summary}`,
        reason && reason !== summary ? `*Reason:* ${reason}` : undefined,
        cwd ? `*CWD:* \`${cwd}\`` : undefined
    ].filter(Boolean).join("\n");

    const blockId = `approval_${req.callId}`;
    const buttonDefs: Array<{
        text: string;
        actionId: string;
        value: string;
        style?: "primary" | "danger";
    }> = [];

    for (const action of req.availableActions) {
        if (action === "approve") {
            buttonDefs.push({
                text: "✅ Approve",
                actionId: "codex_approve",
                value: JSON.stringify({
                    action: "approve",
                    callId: req.approvalId,
                    turnId: req.turnId,
                    threadId: req.threadId,
                    approvalType: req.approvalType
                }),
                style: "primary"
            });
        } else if (action === "deny") {
            buttonDefs.push({
                text: "❌ Deny",
                actionId: "codex_deny",
                value: JSON.stringify({
                    action: "deny",
                    callId: req.approvalId,
                    turnId: req.turnId,
                    threadId: req.threadId,
                    approvalType: req.approvalType
                }),
                style: "danger"
            });
        } else if (action === "approve_always") {
            buttonDefs.push({
                text: "🔓 Always Approve",
                actionId: "codex_approve_always",
                value: JSON.stringify({
                    action: "approve_always",
                    callId: req.approvalId,
                    turnId: req.turnId,
                    threadId: req.threadId,
                    approvalType: req.approvalType
                })
            });
        }
    }

    return [
        section(lines),
        actions(blockId, buttonDefs)
    ];
}

/**
 * 构建用户输入请求 blocks。
 */
export function buildUserInputBlocks(req: IMUserInputRequest): SlackBlock[] {
    const lines = req.questions.map((q) => {
        const opts = q.options?.length ? ` (${q.options.join(" / ")})` : "";
        return `❓ ${q.text}${opts}`;
    });
    return [section(`📝 *User Input Required*\nCall ID: \`${req.callId}\`\n${lines.join("\n")}\nReply with \`/reply ${req.callId} <answer>\`.`)];
}

/**
 * 构建 diff / 文件变更 blocks。
 */
export function buildDiffBlocks(diffSummary: string, files: string[], stats?: { additions: number; deletions: number }): SlackBlock[] {
    if (files.length === 0) return [];

    const statsText = stats ? ` \`+${stats.additions} / -${stats.deletions}\`` : "";
    const fileList = files.map((f) => `\`${f}\``).join(", ");

    return [
        divider(),
        section(`📝 ${fileList}${statsText}`),
        codeBlock(diffSummary.slice(0, 2000))
    ];
}

/**
 * 构建 Turn 完成摘要 blocks — footer 区域。
 */
export function buildSummaryBlocks(summary: IMTurnSummary): SlackBlock[] {
    const tokens = summary.tokenUsage
        ? `${summary.tokenUsage.input + summary.tokenUsage.output} tokens`
        : "-";
    const files = summary.filesChanged.length > 0
        ? `${summary.filesChanged.length} file${summary.filesChanged.length > 1 ? "s" : ""} changed`
        : "no files changed";

    return [
        divider(),
        context(`✅ Completed · ${tokens} · ${files}`)
    ];
}

/**
 * 构建运行中操作 blocks — 停止按钮。
 */
export function buildRunningActions(chatId: string, turnId: string): SlackBlock[] {
    return [
        divider(),
        actions(`running_${turnId}`, [
            {
                text: "🛑 Stop",
                actionId: "codex_interrupt",
                value: JSON.stringify({ action: "interrupt", chatId, turnId }),
                style: "danger"
            }
        ])
    ];
}

/**
 * 构建完成后操作 blocks — 批准 / 撤销。
 */
export function buildCompletedActions(chatId: string, turnId: string): SlackBlock[] {
    return [
        divider(),
        actions(`completed_${turnId}`, [
            {
                text: "✅ Approve",
                actionId: "codex_accept",
                value: JSON.stringify({ action: "accept_changes", chatId, turnId }),
                style: "primary"
            },
            {
                text: "↩️ Revert",
                actionId: "codex_revert",
                value: JSON.stringify({ action: "revert_changes", chatId, turnId }),
                style: "danger"
            }
        ])
    ];
}

/**
 * 构建通知消息 blocks (error/warning)。
 */
export function buildNotificationBlocks(category: string, title: string, detail?: string): SlackBlock[] {
    const icon = category === "error" ? "🚨" : category === "warning" ? "⚠️" : "ℹ️";
    const blocks: SlackBlock[] = [section(`${icon} *${title}*`)];
    if (detail) {
        blocks.push(context(detail));
    }
    return blocks;
}

/**
 * 从进度事件更新进度条条目列表。
 * 返回新的条目列表 (begin → 添加, end → 替换)。
 */
export function applyProgressEvent(entries: ProgressEntry[], event: IMProgressEvent): ProgressEntry[] {
    const icon = progressIcon(event);
    const entry: ProgressEntry = {
        icon,
        label: event.label,
        tool: event.tool,
        duration: event.duration
    };

    if (event.phase === "begin") {
        return [...entries, entry];
    }

    // end: 替换最后一个同类 begin
    let idx = -1;
    for (let i = entries.length - 1; i >= 0; i -= 1) {
        const candidate = entries[i];
        if (candidate.tool === event.tool && candidate.icon === "🔄") {
            idx = i;
            break;
        }
    }
    if (idx >= 0) {
        const updated = [...entries];
        updated[idx] = entry;
        return updated;
    }
    return [...entries, entry];
}
