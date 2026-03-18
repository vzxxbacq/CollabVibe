import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteApprovalStore } from "../../src/sqlite-approval-store";

function dbPath(name: string): string {
  return join(tmpdir(), `codex-im-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

describe("sqlite-approval-store", () => {
  const files: string[] = [];

  afterEach(() => {
    for (const file of files) {
      rmSync(file, { force: true });
    }
    files.length = 0;
  });

  it("stores and updates approval decisions in sqlite", async () => {
    const file = dbPath("approval-store");
    files.push(file);
    const db = new DatabaseSync(file);
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
    const store = new SqliteApprovalStore(db);

    await store.save({
      approvalId: "appr-1",
      approverId: "user-1",
      action: "approve"
    });
    expect(await store.getById("appr-1")).toEqual({
      id: "appr-1",
      decision: "approve",
      actor_id: "user-1"
    });

    await store.save({
      approvalId: "appr-1",
      approverId: "user-2",
      action: "deny"
    });
    expect(await store.getById("appr-1")).toEqual({
      id: "appr-1",
      decision: "deny",
      actor_id: "user-2"
    });
    db.close();

    const reopened = new DatabaseSync(file);
    const reopenedStore = new SqliteApprovalStore(reopened);
    expect(await reopenedStore.getById("appr-1")).toEqual({
      id: "appr-1",
      decision: "deny",
      actor_id: "user-2"
    });
    reopened.close();
  }, 20_000);

  it("[C8c-3] returns null when approval id is not found", async () => {
    const file = dbPath("approval-store-missing");
    files.push(file);
    const db = new DatabaseSync(file);
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
    const store = new SqliteApprovalStore(db);
    expect(await store.getById("appr-404")).toBeNull();
    db.close();
  }, 20_000);
});
