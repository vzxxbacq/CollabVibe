/**
 * Review issue regression tests for SQLite approval persistence
 * Covers: #5 (approval store loses context fields — project_id, thread_id, turn_id, approval_type)
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteApprovalStore } from "../../src/sqlite-approval-store";

function dbPath(name: string): string {
    return join(tmpdir(), `codex-im-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

function createApprovalTable(db: DatabaseSync): void {
    db.exec(
        `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      decision TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );`
    );
}

interface FullApprovalRow {
    id: string;
    project_id: string;
    thread_id: string;
    turn_id: string;
    approval_type: string;
    decision: string;
    actor_id: string;
}

describe("persistence-review: regression tests for issue #5", () => {
    const files: string[] = [];

    afterEach(() => {
        for (const file of files) {
            rmSync(file, { force: true });
        }
        files.length = 0;
    });

    it("[R5-1] approval store persists provided project_id", async () => {
        const file = dbPath("review-5-1");
        files.push(file);
        const db = new DatabaseSync(file);
        createApprovalTable(db);
        const store = new SqliteApprovalStore(db);

        await store.save({
            approvalId: "appr-r5-1",
            approverId: "user-1",
            action: "approve",
            projectId: "proj-123"
        });

        // Query all fields directly
        const row = db
            .prepare("SELECT * FROM approvals WHERE id = ?")
            .get("appr-r5-1") as FullApprovalRow | undefined;

        expect(row).toBeDefined();
        expect(row!.project_id).toBe("proj-123");

        db.close();
    }, 20_000);

    it("[R5-2] approval store persists provided thread_id and turn_id", async () => {
        const file = dbPath("review-5-2");
        files.push(file);
        const db = new DatabaseSync(file);
        createApprovalTable(db);
        const store = new SqliteApprovalStore(db);

        await store.save({
            approvalId: "appr-r5-2",
            approverId: "user-1",
            action: "deny",
            threadId: "thr-9",
            turnId: "turn-9"
        });

        const row = db
            .prepare("SELECT * FROM approvals WHERE id = ?")
            .get("appr-r5-2") as FullApprovalRow | undefined;

        expect(row).toBeDefined();
        expect(row!.thread_id).toBe("thr-9");
        expect(row!.turn_id).toBe("turn-9");

        db.close();
    }, 20_000);

    it("[R5-3] approval store persists provided approval_type", async () => {
        const file = dbPath("review-5-3");
        files.push(file);
        const db = new DatabaseSync(file);
        createApprovalTable(db);
        const store = new SqliteApprovalStore(db);

        await store.save({
            approvalId: "appr-r5-3",
            approverId: "user-1",
            action: "approve",
            approvalType: "file_change"
        });

        const row = db
            .prepare("SELECT * FROM approvals WHERE id = ?")
            .get("appr-r5-3") as FullApprovalRow | undefined;

        expect(row).toBeDefined();
        expect(row!.approval_type).toBe("file_change");

        db.close();
    }, 20_000);
});
