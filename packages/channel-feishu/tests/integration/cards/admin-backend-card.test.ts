/**
 * Admin backend card: two-level layout tests.
 * - Overview card: no forms, only edit buttons per backend.
 * - Edit card: per-backend forms with sanitized element_ids.
 */
import { describe, expect, it, vi } from "vitest";

import { FeishuOutputAdapter } from "../../../src/feishu-output-adapter";
import type { IMAdminBackendPanel } from "../../../../channel-core/src/im-output";

function makeClient() {
    return {
        sendMessage: vi.fn(async () => "msg-1"),
        sendInteractiveCard: vi.fn(async () => "card-token-1"),
        updateInteractiveCard: vi.fn(async () => undefined),
        pinMessage: vi.fn(async () => undefined)
    };
}

/** Recursively collect all element_id values from a card JSON object */
function collectElementIds(obj: unknown, ids: string[] = []): string[] {
    if (obj === null || obj === undefined) return ids;
    if (Array.isArray(obj)) {
        for (const item of obj) collectElementIds(item, ids);
    } else if (typeof obj === "object") {
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            if (key === "element_id" && typeof value === "string") {
                ids.push(value);
            }
            collectElementIds(value, ids);
        }
    }
    return ids;
}

/** Recursively collect all action values from buttons (supports v1 value and v2 behaviors) */
function collectActions(obj: unknown, actions: string[] = []): string[] {
    if (obj === null || obj === undefined) return actions;
    if (Array.isArray(obj)) {
        for (const item of obj) collectActions(item, actions);
    } else if (typeof obj === "object") {
        const rec = obj as Record<string, unknown>;
        if (rec.tag === "button") {
            // v1: value.action
            if (typeof (rec.value as Record<string, unknown>)?.action === "string") {
                actions.push((rec.value as Record<string, unknown>).action as string);
            }
            // v2: behaviors[].value.action
            if (Array.isArray(rec.behaviors)) {
                for (const b of rec.behaviors) {
                    const bv = (b as Record<string, unknown>)?.value as Record<string, unknown> | undefined;
                    if (typeof bv?.action === "string") {
                        actions.push(bv.action as string);
                    }
                }
            }
        }
        for (const value of Object.values(rec)) {
            collectActions(value, actions);
        }
    }
    return actions;
}

const sampleData: IMAdminBackendPanel = {
    kind: "admin_backend",
    backends: [
        {
            name: "claude-code",
            serverCmd: "claude",
            cmdAvailable: true,
            configPath: "/tmp/claude.json",
            configExists: true,
            providers: [
                {
                    name: "my-provider",
                    baseUrl: "https://api.example.com",
                    apiKeyEnv: "MY_KEY",
                    apiKeySet: true,
                    isActive: true,
                    models: [{ name: "model-1", available: true, isCurrent: true }]
                }
            ]
        },
        {
            name: "codex",
            serverCmd: "codex",
            cmdAvailable: true,
            configPath: "/tmp/codex.toml",
            configExists: true,
            providers: [
                {
                    name: "openai",
                    baseUrl: "https://api.openai.com",
                    apiKeyEnv: "OPENAI_KEY",
                    apiKeySet: true,
                    isActive: true,
                    models: []
                }
            ]
        }
    ]
};

describe("admin-backend-card: two-level layout", () => {
    it("overview card has no forms, only edit buttons per backend", () => {
        const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
        const card = adapter.buildAdminBackendCard(sampleData);
        const elementIds = collectElementIds(card);
        const serialized = JSON.stringify(card);

        // Overview card should have NO form element_ids
        expect(elementIds.length).toBe(0);

        // Should have edit buttons for each backend
        expect(serialized).toContain("admin_backend_edit");
        expect(serialized).toContain("admin_panel_home");
    });

    it("add-provider form card has sanitized element_ids (no hyphens)", () => {
        const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
        const card = adapter.buildAdminBackendAddProviderCard(sampleData, "claude-code");
        const elementIds = collectElementIds(card);

        expect(elementIds.length).toBeGreaterThan(0);
        for (const id of elementIds) {
            expect(id).not.toContain("-");
            expect(id).toMatch(/^[a-zA-Z0-9_]+$/);
            expect(id.length).toBeLessThanOrEqual(20);
        }
    });

    it("add-provider card has correct element_id", () => {
        const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
        const card = adapter.buildAdminBackendAddProviderCard(sampleData, "codex");
        const elementIds = collectElementIds(card);

        expect(elementIds).toContain("af0");
    });

    it("edit card falls back to overview if backend not found", () => {
        const adapter = new FeishuOutputAdapter(makeClient(), { cardThrottleMs: 0 });
        const card = adapter.buildAdminBackendEditCard(sampleData, "nonexistent");
        const serialized = JSON.stringify(card);

        // Should fall back to overview card
        expect(serialized).toContain("admin_backend_edit");
    });
});
