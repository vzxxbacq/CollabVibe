import { describe, expect, it } from "vitest";

import {
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
    header,
    section
} from "../../src/slack-block-builder";
import type { IMApprovalRequest, IMProgressEvent, IMTurnSummary, IMUserInputRequest } from "../../../channel-core/src/index";

// ── 基础构建块 ──────────────────────────────────────────────────────────────

describe("slack-block-builder: basic blocks", () => {
    it("section creates markdown section", () => {
        const block = section("Hello *world*");
        expect(block).toEqual({
            type: "section",
            text: { type: "mrkdwn", text: "Hello *world*" }
        });
    });

    it("context creates context block with text elements", () => {
        const block = context("foo", "bar");
        expect(block).toEqual({
            type: "context",
            elements: [
                { type: "mrkdwn", text: "foo" },
                { type: "mrkdwn", text: "bar" }
            ]
        });
    });

    it("divider creates divider block", () => {
        expect(divider()).toEqual({ type: "divider" });
    });

    it("header creates header block", () => {
        const block = header("CodeBridge");
        expect(block).toEqual({
            type: "header",
            text: { type: "plain_text", text: "CodeBridge", emoji: true }
        });
    });

    it("codeBlock creates rich_text_preformatted", () => {
        const block = codeBlock("const x = 1;");
        expect(block).toMatchObject({
            type: "rich_text",
            elements: [
                {
                    type: "rich_text_preformatted",
                    elements: [{ type: "text", text: "const x = 1;" }]
                }
            ]
        });
    });
});

// ── 组合构建器 ────────────────────────────────────────────────────────────

describe("slack-block-builder: composite builders", () => {
    it("buildProgressBlocks returns empty for no entries", () => {
        expect(buildProgressBlocks([])).toEqual([]);
    });

    it("buildProgressBlocks renders recent entries with omission", () => {
        const entries: ProgressEntry[] = Array.from({ length: 8 }, (_, i) => ({
            icon: "✅",
            label: `step-${i}`,
            tool: "exec_command"
        }));
        const blocks = buildProgressBlocks(entries);
        expect(blocks.length).toBe(2); // divider + context
        expect(blocks[0]).toEqual({ type: "divider" });

        const contextText = (blocks[1] as { elements: Array<{ text: string }> }).elements[0].text;
        expect(contextText).toContain("2 items omitted");
        expect(contextText).toContain("step-7");
    });

    it("buildApprovalBlocks creates section + actions", () => {
        const req: IMApprovalRequest = {
            kind: "approval",
            threadId: "thr-1",
            turnId: "turn-1",
            callId: "call-1",
            approvalType: "command_exec",
            description: "Run npm test",
            command: ["npm", "test"],
            availableActions: ["approve", "deny"]
        };
        const blocks = buildApprovalBlocks(req);
        expect(blocks.length).toBe(2);
        expect(blocks[0]).toMatchObject({ type: "section" });
        expect(blocks[1]).toMatchObject({ type: "actions" });

        const actionBlock = blocks[1] as { elements: Array<{ action_id: string; style?: string }> };
        expect(actionBlock.elements).toHaveLength(2);
        expect(actionBlock.elements[0].action_id).toBe("codex_approve");
        expect(actionBlock.elements[0].style).toBe("primary");
        expect(actionBlock.elements[1].action_id).toBe("codex_deny");
        expect(actionBlock.elements[1].style).toBe("danger");
    });

    it("buildUserInputBlocks renders questions", () => {
        const req: IMUserInputRequest = {
            kind: "user_input",
            threadId: "thr-1",
            turnId: "turn-1",
            callId: "call-1",
            questions: [
                { text: "Which file?", options: ["a.ts", "b.ts"] },
                { text: "Proceed?" }
            ]
        };
        const blocks = buildUserInputBlocks(req);
        expect(blocks.length).toBe(1);
        const sectionText = (blocks[0] as { text: { text: string } }).text.text;
        expect(sectionText).toContain("Which file?");
        expect(sectionText).toContain("a.ts / b.ts");
        expect(sectionText).toContain("Proceed?");
    });

    it("buildDiffBlocks returns empty for no files", () => {
        expect(buildDiffBlocks("", [], undefined)).toEqual([]);
    });

    it("buildDiffBlocks renders file list + code block", () => {
        const blocks = buildDiffBlocks("+new\n-old", ["a.ts"], { additions: 1, deletions: 1 });
        expect(blocks.length).toBe(3); // divider + section + codeBlock
        const sectionText = (blocks[1] as { text: { text: string } }).text.text;
        expect(sectionText).toContain("`a.ts`");
        expect(sectionText).toContain("+1 / -1");
    });

    it("buildSummaryBlocks shows token count and file count", () => {
        const summary: IMTurnSummary = {
            kind: "turn_summary",
            threadId: "thr-1",
            turnId: "turn-1",
            filesChanged: ["a.ts", "b.ts"],
            tokenUsage: { input: 100, output: 50 }
        };
        const blocks = buildSummaryBlocks(summary);
        expect(blocks.length).toBe(2); // divider + context
        const text = (blocks[1] as { elements: Array<{ text: string }> }).elements[0].text;
        expect(text).toContain("150 tokens");
        expect(text).toContain("2 files changed");
    });

    it("buildRunningActions shows stop button", () => {
        const blocks = buildRunningActions("ch-1", "turn-1");
        expect(blocks.length).toBe(2); // divider + actions
        expect(blocks[1]).toMatchObject({ type: "actions" });
        const btn = (blocks[1] as { elements: Array<{ action_id: string }> }).elements[0];
        expect(btn.action_id).toBe("codex_interrupt");
    });

    it("buildCompletedActions shows approve + revert", () => {
        const blocks = buildCompletedActions("ch-1", "turn-1");
        expect(blocks.length).toBe(2);
        const els = (blocks[1] as { elements: Array<{ action_id: string }> }).elements;
        expect(els).toHaveLength(2);
        expect(els[0].action_id).toBe("codex_accept");
        expect(els[1].action_id).toBe("codex_revert");
    });

    it("buildNotificationBlocks shows icon + title + detail", () => {
        const blocks = buildNotificationBlocks("error", "Rate limited", "Try again in 30s");
        expect(blocks.length).toBe(2);
        const title = (blocks[0] as { text: { text: string } }).text.text;
        expect(title).toContain("🚨");
        expect(title).toContain("Rate limited");
    });
});

// ── applyProgressEvent ──────────────────────────────────────────────────────

describe("slack-block-builder: applyProgressEvent", () => {
    it("begin adds new entry", () => {
        const event: IMProgressEvent = {
            kind: "progress",
            turnId: "turn-1",
            phase: "begin",
            tool: "exec_command",
            label: "npm test"
        };
        const result = applyProgressEvent([], event);
        expect(result).toHaveLength(1);
        expect(result[0].icon).toBe("🔄");
        expect(result[0].label).toBe("npm test");
    });

    it("end replaces matching begin entry", () => {
        const entries: ProgressEntry[] = [
            { icon: "🔄", label: "npm test", tool: "exec_command" }
        ];
        const event: IMProgressEvent = {
            kind: "progress",
            turnId: "turn-1",
            phase: "end",
            tool: "exec_command",
            label: "npm test",
            status: "success",
            duration: "1.2s"
        };
        const result = applyProgressEvent(entries, event);
        expect(result).toHaveLength(1);
        expect(result[0].icon).toBe("✅");
        expect(result[0].duration).toBe("1.2s");
    });

    it("failed end shows ❌", () => {
        const entries: ProgressEntry[] = [
            { icon: "🔄", label: "npm test", tool: "exec_command" }
        ];
        const event: IMProgressEvent = {
            kind: "progress",
            turnId: "turn-1",
            phase: "end",
            tool: "exec_command",
            label: "npm test",
            status: "failed"
        };
        const result = applyProgressEvent(entries, event);
        expect(result[0].icon).toBe("❌");
    });
});
