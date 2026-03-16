/**
 * Tests for help thread card optimization:
 * - buildHelpThreadCard no longer contains inline form
 * - buildHelpThreadCard has navigation button for "新建 Thread"
 * - buildHelpThreadNewCard is a proper form card with back navigation
 */
import { describe, expect, it } from "vitest";
import { buildHelpThreadCard, buildHelpThreadNewCard } from "../../../src/feishu-card-builders";

function deepFindAll(obj: unknown, predicate: (v: unknown) => boolean): unknown[] {
  const results: unknown[] = [];
  function walk(node: unknown) {
    if (predicate(node)) results.push(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
    } else if (node && typeof node === "object") {
      for (const val of Object.values(node as Record<string, unknown>)) walk(val);
    }
  }
  walk(obj);
  return results;
}

function deepFind(obj: unknown, predicate: (v: unknown) => boolean): unknown | undefined {
  return deepFindAll(obj, predicate)[0];
}

const MOCK_THREADS = [
  { threadName: "feature-auth", threadId: "tid-12345678-abcd", active: true },
  { threadName: "fix-bug", threadId: "tid-87654321-dcba", active: false }
];

const MOCK_BACKENDS = [
  { name: "codex", models: ["gpt-5-codex", "gpt-4.1"] },
  { name: "opencode", models: ["MiniMax-M2.5"] }
];

// ── buildHelpThreadCard ────────────────────────────────────────────────────

describe("buildHelpThreadCard (refactored)", () => {
  it("does NOT contain any form element", () => {
    const card = buildHelpThreadCard(MOCK_THREADS, "user-1", "Alice", true);
    const forms = deepFindAll(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).tag === "form")
    );
    expect(forms).toHaveLength(0);
  });

  it("contains a navigation button with action help_thread_new", () => {
    const card = buildHelpThreadCard(MOCK_THREADS, "user-1", "Alice", false);
    const navBtn = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).action === "help_thread_new")
    );
    expect(navBtn).toBeDefined();
  });

  it("contains back panel with action help_home", () => {
    const card = buildHelpThreadCard([], "user-1", undefined, true);
    const backBtn = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).action === "help_home")
    );
    expect(backBtn).toBeDefined();
  });

  it("shows correct thread count in header tag", () => {
    const card = buildHelpThreadCard(MOCK_THREADS, "user-1", "Alice", true);
    const header = (card as Record<string, unknown>).header as Record<string, unknown>;
    const tagList = header.text_tag_list as Array<Record<string, unknown>>;
    // 2 threads + 1 main = 3 个
    expect(JSON.stringify(tagList)).toContain("3 个");
  });

  it("displays thread list items", () => {
    const card = buildHelpThreadCard(MOCK_THREADS, "user-1", "Alice", false);
    const body = (card as Record<string, unknown>).body as Record<string, unknown>;
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).toContain("feature-auth");
    expect(bodyStr).toContain("fix-bug");
  });
});

// ── buildHelpThreadNewCard ─────────────────────────────────────────────────

describe("buildHelpThreadNewCard", () => {
  it("contains a form with input and select_static", () => {
    const card = buildHelpThreadNewCard("user-1", MOCK_BACKENDS, "codex", "gpt-5-codex");
    const form = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).tag === "form")
    );
    expect(form).toBeDefined();

    const input = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).tag === "input")
    );
    expect(input).toBeDefined();

    const select = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).tag === "select_static")
    );
    expect(select).toBeDefined();
  });

  it("submit button triggers help_create_thread action", () => {
    const card = buildHelpThreadNewCard("user-1", MOCK_BACKENDS);
    const submitAction = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).action === "help_create_thread")
    );
    expect(submitAction).toBeDefined();
  });

  it("has back panel navigating to help_threads", () => {
    const card = buildHelpThreadNewCard("user-1", MOCK_BACKENDS);
    const backBtn = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).action === "help_threads")
    );
    expect(backBtn).toBeDefined();
  });

  it("has correct header template and title", () => {
    const card = buildHelpThreadNewCard("user-1", MOCK_BACKENDS);
    const header = (card as Record<string, unknown>).header as Record<string, unknown>;
    expect(header.template).toBe("blue");
    const title = header.title as Record<string, string>;
    expect(title.content).toBe("新建 Thread");
  });

  it("sets initial_option when defaults match", () => {
    const card = buildHelpThreadNewCard("user-1", MOCK_BACKENDS, "codex", "gpt-5-codex");
    const select = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).tag === "select_static")
    ) as Record<string, unknown>;
    expect(select.initial_option).toBe("codex::gpt-5-codex");
  });

  it("includes all backend:model options", () => {
    const card = buildHelpThreadNewCard("user-1", MOCK_BACKENDS);
    const select = deepFind(card, v =>
      Boolean(v && typeof v === "object" && (v as Record<string, unknown>).tag === "select_static")
    ) as Record<string, unknown>;
    const options = select.options as Array<{ value: string }>;
    const values = options.map(o => o.value);
    expect(values).toContain("codex::gpt-5-codex");
    expect(values).toContain("codex::gpt-4.1");
    expect(values).toContain("opencode::MiniMax-M2.5");
    expect(values).toHaveLength(3);
  });
});
