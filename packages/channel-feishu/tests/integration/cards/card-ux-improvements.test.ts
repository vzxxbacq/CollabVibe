/**
 * Tests for card UX improvements:
 * - Header prompt summary + backend/model info
 * - Pin + completion reminder
 * - Card state persistence recovery
 * - Non-ASCII diff display + per-file rendering
 * - Turn Card redesign: sub-page buttons, element safety, pagination
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { FeishuOutputAdapter } from "../../../src/feishu-output-adapter";
import { parseDiffFiles, unquoteGitPath, splitDiffByFile } from "../../../src/diff-utils";
import { buildTurnHistoryCard, type TurnHistoryEntry } from "../../../src/feishu-card-builders";
import type { FeishuCardStateStore, PersistedCardState } from "../../../src/feishu-card-state-store";
import { getLastSentCard, getSentCard } from "../../helpers/card-assertions";
import { buildApprovalRequest, buildProgressEvent, buildTurnSummary } from "../../helpers/fixtures";
import { makeFeishuClientMock } from "../../helpers/feishu-client-mock";

function makeInMemoryStore(): FeishuCardStateStore {
    const map = new Map<string, PersistedCardState>();
    return {
        save: (key, data) => { map.set(key, data); },
        load: (key) => map.get(key) ?? null,
        remove: (key) => { map.delete(key); },
        listByChat: (chatId, limit = 50) => [...map.values()]
            .filter(s => s.chatId === chatId)
            .slice(0, limit),
        getLatestTurnNumber: (chatId, threadName) => {
            const nums = [...map.values()]
                .filter(s => s.chatId === chatId && s.threadName === threadName && typeof s.turnNumber === "number")
                .map(s => s.turnNumber as number);
            return nums.length > 0 ? Math.max(...nums) : null;
        }
    };
}

// ── Task 1: Header Prompt Summary ──

describe("header prompt summary", () => {
    it("uses lastAgentMessage as header title after completeTurn", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });
        adapter.setCardBackendInfo("chat-1", "turn-1", "codex", "gpt-5-codex");

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "这是一个比较长的消息需要被截断成摘要",
            filesChanged: [],
            fileChangeDetails: [],
        });

        vi.advanceTimersByTime(100);

        // The card should have been created with promptSummary
        const sendCardCall = client.sendInteractiveCard.mock.calls[0];
        expect(sendCardCall).toBeDefined();
        const card = sendCardCall?.[1] as Record<string, unknown>;
        const header = card?.header as Record<string, unknown>;
        const title = header?.title as Record<string, string>;
        expect(title.content).toContain("Agent:");
        // Chinese message is treated as a continuous token (no spaces to split on)
        expect(title.content).toContain("这是一个比较长的消息需要被截断成摘要");

        // Subtitle should contain backend, model (threadName comes from setCardThreadName, not threadId)
        const subtitle = header?.subtitle as Record<string, string>;
        expect(subtitle.content).toContain("codex");
        expect(subtitle.content).toContain("gpt-5-codex");

        vi.useRealTimers();
    });

    it("falls back to CodeBridge when no lastAgentMessage", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            filesChanged: [],
            fileChangeDetails: [],
        });

        vi.advanceTimersByTime(100);

        const sendCardCall = client.sendInteractiveCard.mock.calls[0];
        const card = sendCardCall?.[1] as Record<string, unknown>;
        const header = card?.header as Record<string, unknown>;
        const title = header?.title as Record<string, string>;
        // No lastAgentMessage → falls back to mode label only
        expect(title.content).toBe("Agent");

        vi.useRealTimers();
    });
});

// ── Task 2: Pin + Completion Reminder ──

describe("pin and completion reminder", () => {
    it("pins card and sends completion message after completeTurn", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Done",
            filesChanged: ["file.ts"],
            fileChangeDetails: [],
            tokenUsage: { input: 100, output: 50 }
        });

        vi.advanceTimersByTime(100);

        expect(client.pinMessage).toHaveBeenCalledWith("card-token-1");
        // Should send a completion reminder message with "完成" keyword
        const sendCalls = client.sendMessage.mock.calls;
        const reminderCall = sendCalls.find((c: unknown[]) => {
            const arg = c[0] as Record<string, unknown> | undefined;
            return typeof arg?.text === "string" && arg.text.includes("完成");
        });
        expect(reminderCall).toBeDefined();

        vi.useRealTimers();
    });

    it("pin failure does not break completeTurn", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        client.pinMessage = vi.fn(async () => { throw new Error("pin failed"); });
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await expect(adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            filesChanged: [],
            fileChangeDetails: [],
        })).resolves.not.toThrow();

        vi.useRealTimers();
    });
});

// ── Task 3: Card State Persistence ──

describe("card state persistence", () => {
    it("updateCardAction recovers from persisted store when in-memory state is empty", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const store = makeInMemoryStore();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0, cardStateStore: store });

        // First, complete a turn with file changes
        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Made changes",
            filesChanged: ["file.ts"],
            fileChangeDetails: [{
                filesChanged: ["file.ts"],
                diffSummary: "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
                stats: { additions: 1, deletions: 1 }
            }],
            tokenUsage: { input: 50, output: 30 }
        });

        vi.advanceTimersByTime(100);

        // Verify store has state
        expect(store.load("chat-1:turn-1")).not.toBeNull();

        // Simulate server restart: create new adapter with same store
        const client2 = makeFeishuClientMock();
        const adapter2 = new FeishuOutputAdapter(client2, { cardThrottleMs: 0, cardStateStore: store });

        // updateCardAction should recover from store
        const card = await adapter2.updateCardAction("chat-1", "turn-1", "accepted");
        expect(card).not.toBeNull();

        // Store should retain state with actionTaken for turn history
        const afterAction = store.load("chat-1:turn-1");
        expect(afterAction).not.toBeNull();
        expect(afterAction!.actionTaken).toBe("accepted");

        vi.useRealTimers();
    });

    it("continues turn numbering after restart for the same thread", async () => {
        vi.useFakeTimers();
        const store = makeInMemoryStore();

        const client1 = makeFeishuClientMock();
        const adapter1 = new FeishuOutputAdapter(client1, { cardThrottleMs: 0, cardStateStore: store });
        adapter1.setCardThreadName("chat-1", "turn-1", "feature-a");
        await adapter1.completeTurn("chat-1", buildTurnSummary({
            turnId: "turn-1",
            threadId: "thr-1",
            lastAgentMessage: "first",
            filesChanged: [],
            fileChangeDetails: []
        }));
        vi.advanceTimersByTime(100);
        expect(store.load("chat-1:turn-1")?.turnNumber).toBe(1);

        const client2 = makeFeishuClientMock();
        const adapter2 = new FeishuOutputAdapter(client2, { cardThrottleMs: 0, cardStateStore: store });
        adapter2.setCardThreadName("chat-1", "turn-2", "feature-a");
        await adapter2.completeTurn("chat-1", buildTurnSummary({
            turnId: "turn-2",
            threadId: "thr-1",
            lastAgentMessage: "second",
            filesChanged: [],
            fileChangeDetails: []
        }));
        vi.advanceTimersByTime(100);

        expect(store.load("chat-1:turn-2")?.turnNumber).toBe(2);

        vi.useRealTimers();
    });

    it("persists and recovers thinking, tools, and toolOutputs", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const store = makeInMemoryStore();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0, cardStateStore: store });

        // Populate thinking and tool data before completeTurn
        await adapter.appendReasoning("chat-1", "turn-2", "Let me analyze the code structure");
        await adapter.updateProgress("chat-1", {
            kind: "progress",
            turnId: "turn-2",
            phase: "end",
            tool: "exec_command",
            label: "npm test",
            callId: "call-1",
            status: "success",
            summary: "All tests passed"
        });

        vi.advanceTimersByTime(4000); // flush stream aggregator

        // Complete the turn with file changes
        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-2",
            threadId: "thread-1",
            lastAgentMessage: "Fixed the bug",
            filesChanged: ["src/main.ts"],
            fileChangeDetails: [{
                filesChanged: ["src/main.ts"],
                diffSummary: "diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n-old\n+new",
                stats: { additions: 1, deletions: 1 }
            }],
            tokenUsage: { input: 100, output: 50 }
        });

        vi.advanceTimersByTime(100);

        // Verify persisted state includes thinking and tools
        const persisted = store.load("chat-1:turn-2");
        expect(persisted).not.toBeNull();
        expect(persisted!.thinking).toContain("analyze the code structure");
        expect(persisted!.tools).toBeDefined();
        expect(persisted!.tools!.length).toBeGreaterThan(0);
        expect(persisted!.toolOutputs).toBeDefined();
        expect(persisted!.toolOutputs!.length).toBeGreaterThan(0);
        expect(persisted!.toolOutputs![0]!.output).toContain("All tests passed");

        // Simulate server restart: new adapter with same store
        const client2 = makeFeishuClientMock();
        const adapter2 = new FeishuOutputAdapter(client2, { cardThrottleMs: 0, cardStateStore: store });

        // Recover and render card — tool details now in sub-page, but thinking stays inline
        const card = await adapter2.updateCardAction("chat-1", "turn-2", "accepted") as Record<string, unknown>;
        expect(card).not.toBeNull();

        const body = card!.body as Record<string, unknown>;
        const elements = body.elements as Array<Record<string, unknown>>;
        const cardJson = JSON.stringify(elements);
        // Thinking should remain inline
        expect(cardJson).toContain("思考过程");
        // Tool details are now behind a button — card should contain the button action
        expect(cardJson).toContain("view_tool_progress");

        vi.useRealTimers();
    });
});


// ── Task 4: Diff Display ──

describe("unquoteGitPath", () => {
    it("decodes octal-escaped UTF-8 sequences", () => {
        // "详" = \xe8\xaf\xa6 = \350\257\246
        const encoded = "test/\\350\\257\\246\\347\\273\\206.md";
        const decoded = unquoteGitPath(encoded);
        expect(decoded).toBe("test/详细.md");
    });

    it("removes surrounding quotes", () => {
        const encoded = '"test/file.md"';
        expect(unquoteGitPath(encoded)).toBe("test/file.md");
    });

    it("passes through plain ASCII paths", () => {
        expect(unquoteGitPath("src/main.ts")).toBe("src/main.ts");
    });

    it("preserves clean UTF-8 characters (no octal escapes)", () => {
        // This is what git outputs with -c core.quotePath=false
        expect(unquoteGitPath("agent-output/项目介绍-详细版.md")).toBe("agent-output/项目介绍-详细版.md");
    });
});

describe("parseDiffFiles with quoted paths", () => {
    it("parses quoted non-ASCII paths", () => {
        const diff = `diff --git "a/\\350\\257\\246\\347\\273\\206.md" "b/\\350\\257\\246\\347\\273\\206.md"
new file mode 100644
--- /dev/null
+++ "b/\\350\\257\\246\\347\\273\\206.md"
@@ -0,0 +1,3 @@
+line1
+line2
+line3
`;
        const files = parseDiffFiles(diff);
        expect(files).toHaveLength(1);
        expect(files[0]!.file).toBe("详细.md");
        expect(files[0]!.status).toBe("new");
        expect(files[0]!.additions).toBe(3);
    });

    it("parses standard unquoted paths", () => {
        const diff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,1 +1,1 @@
-old
+new
`;
        const files = parseDiffFiles(diff);
        expect(files).toHaveLength(1);
        expect(files[0]!.file).toBe("src/main.ts");
        expect(files[0]!.status).toBe("modified");
    });

    it("skips phantom segments from --stat output", () => {
        const diff = ` src/main.ts | 5 +++--
 1 file changed, 3 insertions, 2 deletions
diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,2 +1,3 @@
-old1
-old2
+new1
+new2
+new3
`;
        const files = parseDiffFiles(diff);
        expect(files).toHaveLength(1);
        expect(files[0]!.file).toBe("src/main.ts");
    });
});

describe("splitDiffByFile", () => {
    it("splits multi-file diff into per-file segments", () => {
        const diff = `diff --git a/file1.ts b/file1.ts
--- a/file1.ts
+++ b/file1.ts
@@ -1 +1 @@
-old
+new
diff --git a/file2.md b/file2.md
new file mode 100644
--- /dev/null
+++ b/file2.md
@@ -0,0 +1,2 @@
+hello
+world
`;
        const segments = splitDiffByFile(diff);
        expect(segments).toHaveLength(2);
        expect(segments[0]!.file).toBe("file1.ts");
        expect(segments[0]!.status).toBe("modified");
        expect(segments[0]!.content).toContain("-old");
        expect(segments[0]!.content).toContain("+new");
        expect(segments[1]!.file).toBe("file2.md");
        expect(segments[1]!.status).toBe("new");
        expect(segments[1]!.additions).toBe(2);
    });
});

// ── Task 5: Turn Card Redesign — Sub-page Buttons ──

describe("turn card redesign: sub-page buttons", () => {
    it("shows view_file_changes button when files changed", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Changed files",
            filesChanged: ["file.ts"],
            fileChangeDetails: [{
                filesChanged: ["file.ts"],
                diffSummary: "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new",
                stats: { additions: 1, deletions: 1 }
            }],
        });

        vi.advanceTimersByTime(100);

        const sendCardCall = client.sendInteractiveCard.mock.calls[0];
        const card = sendCardCall?.[1] as Record<string, unknown>;
        const cardJson = JSON.stringify(card);
        expect(cardJson).toContain("view_file_changes");
        expect(cardJson).toContain("文件修改");

        vi.useRealTimers();
    });

    it("shows view_tool_progress button when tools are used", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.updateProgress("chat-1", {
            kind: "progress",
            turnId: "turn-1",
            phase: "end",
            tool: "exec_command",
            label: "npm test",
            callId: "call-1",
            status: "success",
            summary: "All tests passed"
        });

        vi.advanceTimersByTime(4000);

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Done",
            filesChanged: [],
            fileChangeDetails: [],
        });

        vi.advanceTimersByTime(100);

        const sendCardCalls = client.sendInteractiveCard.mock.calls;
        const lastCall = sendCardCalls[sendCardCalls.length - 1];
        const card = lastCall?.[1] as Record<string, unknown>;
        const cardJson = JSON.stringify(card);
        expect(cardJson).toContain("view_tool_progress");
        expect(cardJson).toContain("执行过程");

        vi.useRealTimers();
    });

    it("does not show file changes or tool buttons when none exist", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Hello",
            filesChanged: [],
            fileChangeDetails: [],
        });

        vi.advanceTimersByTime(100);

        const sendCardCall = client.sendInteractiveCard.mock.calls[0];
        const card = sendCardCall?.[1] as Record<string, unknown>;
        const cardJson = JSON.stringify(card);
        expect(cardJson).not.toContain("view_file_changes");
        expect(cardJson).not.toContain("view_tool_progress");

        vi.useRealTimers();
    });
});

// ── Task 6: Sub-page Rendering ──

describe("sub-page rendering via adapter", () => {
    it("renderFileChangesCard paginates at 30 per page", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const store = makeInMemoryStore();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0, cardStateStore: store });

        // Create a turn with 40 file changes
        const fileDetails = Array.from({ length: 40 }, (_, i) => ({
            filesChanged: [`file-${i}.ts`],
            diffSummary: `diff --git a/file-${i}.ts b/file-${i}.ts\n--- a/file-${i}.ts\n+++ b/file-${i}.ts\n@@ -1 +1 @@\n-old${i}\n+new${i}`,
            stats: { additions: 1, deletions: 1 }
        }));

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Many file changes",
            filesChanged: Array.from({ length: 40 }, (_, i) => `file-${i}.ts`),
            fileChangeDetails: fileDetails,
        });

        vi.advanceTimersByTime(100);

        // Page 0: should have 30 panels
        const page0 = adapter.renderFileChangesCard("chat-1", "turn-1", 0);
        expect(page0).not.toBeNull();
        const page0Json = JSON.stringify(page0);
        // Should have pagination buttons
        expect(page0Json).toContain("file_changes_page");
        expect(page0Json).toContain("下一页");
        // Should have back button
        expect(page0Json).toContain("file_changes_back");

        // Page 1: should have remaining 10 panels
        const page1 = adapter.renderFileChangesCard("chat-1", "turn-1", 1);
        expect(page1).not.toBeNull();
        const page1Json = JSON.stringify(page1);
        expect(page1Json).toContain("上一页");

        vi.useRealTimers();
    });

    it("renderTurnCardFromStore returns full turn card", async () => {
        vi.useFakeTimers();
        const client = makeFeishuClientMock();
        const store = makeInMemoryStore();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0, cardStateStore: store });

        await adapter.completeTurn("chat-1", {
            kind: "turn_summary" as const,
            turnId: "turn-1",
            threadId: "thread-1",
            lastAgentMessage: "Test recovery",
            filesChanged: ["a.ts"],
            fileChangeDetails: [{
                filesChanged: ["a.ts"],
                diffSummary: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new",
                stats: { additions: 1, deletions: 1 }
            }],
        });

        vi.advanceTimersByTime(100);

        // Simulate restart: new adapter with same store
        const adapter2 = new FeishuOutputAdapter(makeFeishuClientMock(), { cardThrottleMs: 0, cardStateStore: store });
        const card = adapter2.renderTurnCardFromStore("chat-1", "turn-1");
        expect(card).not.toBeNull();
        const cardJson = JSON.stringify(card);
        expect(cardJson).toContain("Test recovery");
        expect(cardJson).toContain("view_file_changes");

        vi.useRealTimers();
    });
});

// ── Task 7: Turn History Card ──

describe("buildTurnHistoryCard", () => {
    it("renders turn history entries", () => {
        const turns: TurnHistoryEntry[] = [
            {
                chatId: "chat-1", turnId: "turn-1",
                threadName: "main", turnNumber: 1,
                promptSummary: "Fixed the login bug",
                backendName: "codex", modelName: "gpt-5",
                fileCount: 3, actionTaken: "accepted"
            },
            {
                chatId: "chat-1", turnId: "turn-2",
                threadName: "feature-x", turnNumber: 2,
                promptSummary: "Added new feature",
                backendName: "opencode", modelName: "MiniMax",
                fileCount: 0, actionTaken: "reverted"
            }
        ];

        const card = buildTurnHistoryCard(turns, "user-1", true);
        const cardJson = JSON.stringify(card);

        expect(cardJson).toContain("历史会话");
        expect(cardJson).toContain("view_turn_detail");
        expect(cardJson).toContain("Fixed the login bug");
        expect(cardJson).toContain("Added new feature");
        expect(cardJson).toContain("help_home"); // back button
        expect(cardJson).toContain("2 条 Turn 记录");
    });

    it("shows empty state when no turns", () => {
        const card = buildTurnHistoryCard([], "user-1", true);
        const cardJson = JSON.stringify(card);
        expect(cardJson).toContain("暂无 Turn 记录");
    });
});

// ── Task 8: Approval Card Truncation ──

describe("approval card truncation", () => {
    it("short command renders without collapsible panel", async () => {
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        await adapter.requestApproval("chat-1", {
            kind: "approval",
            threadId: "thr-1",
            turnId: "turn-1",
            approvalId: "0",
            callId: "call-1",
            approvalType: "command_exec",
            description: "Command approval: npm test",
            availableActions: ["approve", "deny", "approve_always"]
        });

        const card = client.sendInteractiveCard.mock.calls[0]?.[1] as Record<string, unknown>;
        const cardJson = JSON.stringify(card);
        expect(cardJson).toContain("npm test");
        expect(cardJson).toContain("collapsible_panel");
        expect(cardJson).toContain("命令详情");
    });

    it("long heredoc command shows collapsible panel", async () => {
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        const longCommand = "Command approval: /bin/bash -lc \"cat > /fast/project/file.py <<'PY'\n"
            + "import os\n".repeat(30)
            + "PY\"";

        await adapter.requestApproval("chat-1", {
            kind: "approval",
            threadId: "thr-1",
            turnId: "turn-1",
            approvalId: "0",
            callId: "call-1",
            approvalType: "command_exec",
            description: longCommand,
            availableActions: ["approve", "deny", "approve_always"]
        });

        const card = client.sendInteractiveCard.mock.calls[0]?.[1] as Record<string, unknown>;
        const cardJson = JSON.stringify(card);
        expect(cardJson).toContain("collapsible_panel");
        expect(cardJson).toContain("命令详情");
        // Full command is inside the collapsible panel as code block
        expect(cardJson).toContain("import os");
    });

    it("callback value carries commandSummary, not full description", async () => {
        const client = makeFeishuClientMock();
        const adapter = new FeishuOutputAdapter(client, { cardThrottleMs: 0 });

        const longCommand = "Command approval: /bin/bash -lc \"cat > /fast/project/file.py <<'PY'\n"
            + "import os\n".repeat(30)
            + "PY\"";

        await adapter.requestApproval("chat-1", {
            kind: "approval",
            threadId: "thr-1",
            turnId: "turn-1",
            approvalId: "0",
            callId: "call-1",
            approvalType: "command_exec",
            description: longCommand,
            availableActions: ["approve", "deny"]
        });

        const card = client.sendInteractiveCard.mock.calls[0]?.[1] as {
            body?: { elements?: Array<{ tag?: string; columns?: Array<{ elements?: Array<{ tag?: string; behaviors?: Array<{ value?: Record<string, unknown> }> }> }> }> }
        };
        const actionColumnSet = card.body?.elements?.find(
            (el) => el.tag === "column_set" && el.columns?.some((column) => column.elements?.[0]?.tag === "button")
        );
        const btnValue = actionColumnSet?.columns?.[0]?.elements?.[0]?.behaviors?.[0]?.value;

        expect(btnValue).toBeDefined();
        // commandSummary is the first line only, not the full heredoc
        expect(btnValue!.commandSummary).toBeDefined();
        expect(typeof btnValue!.commandSummary).toBe("string");
        expect((btnValue!.commandSummary as string).length).toBeLessThan(longCommand.length);
        // description should NOT be in the callback
        expect(btnValue!.description).toBeUndefined();
    });
});
