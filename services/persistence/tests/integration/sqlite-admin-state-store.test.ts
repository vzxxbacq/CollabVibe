import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { SqliteAdminStateStore } from "../../src/sqlite-admin-state-store";

function dbPath(name: string): string {
  return join(tmpdir(), `codex-im-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

describe("sqlite-admin-state-store", () => {
  const files: string[] = [];

  afterEach(() => {
    for (const file of files) {
      rmSync(file, { force: true });
    }
    files.length = 0;
  });

  it("persists wizard/projects/members and restores after restart", async () => {
    const file = dbPath("admin-state");
    files.push(file);
    const db = new DatabaseSync(file);
    const store = new SqliteAdminStateStore(db);
    expect(store.read()).toEqual({
      wizardStep: {},
      projects: [],
      members: {}
    });

    store.write({
      wizardStep: { "org-1": 3 },
      projects: [
        {
          id: "proj-1",
          name: "Payment",
          chatId: "chat-1",
          cwd: "/repo/payment",
          enabledSkills: [],
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          status: "active"
        }
      ],
      members: {
        "proj-1": [{ userId: "u1", role: "maintainer" }]
      }
    });
    db.close();

    const reopened = new DatabaseSync(file);
    const reopenedStore = new SqliteAdminStateStore(reopened);
    expect(reopenedStore.read()).toEqual({
      wizardStep: { "org-1": 3 },
      projects: [
        {
          id: "proj-1",
          name: "Payment",
          chatId: "chat-1",
          cwd: "/repo/payment",
          enabledSkills: [],
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          status: "active"
        }
      ],
      members: {
        "proj-1": [{ userId: "u1", role: "maintainer" }]
      }
    });
    reopened.close();
  }, 20_000);

  it("[C8d-4] throws explicit error when persisted json is corrupted", () => {
    const file = dbPath("admin-state-corrupted");
    files.push(file);
    const db = new DatabaseSync(file);
    const store = new SqliteAdminStateStore(db);

    store.write({
      wizardStep: { "org-1": 1 },
      projects: [
        {
          id: "proj-1",
          name: "Payment",
          chatId: "chat-1",
          cwd: "/repo/payment",
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          status: "active"
        }
      ],
      members: {
        "proj-1": [{ userId: "u1", role: "maintainer" }]
      }
    });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((row) => (row as { name: string }).name);
    for (const table of tables) {
      const count = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
      if (count.total === 0) {
        continue;
      }
      const columns = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row as { name: string; type: string });
      for (const column of columns) {
        if (column.type.toUpperCase().includes("TEXT")) {
          db.exec(`UPDATE ${table} SET ${column.name} = '{broken-json'`);
          break;
        }
      }
      break;
    }

    expect(() => store.read()).toThrowError(/admin_state row is corrupted/i);
    db.close();
  }, 30_000);
});
