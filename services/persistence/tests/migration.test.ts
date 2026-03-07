import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIGRATIONS, runMigrations } from "../src/migrations";

async function applyMigrations(db: DatabaseSync): Promise<void> {
  await runMigrations({
    async execute(sql: string) {
      db.exec(sql);
    },
    async query<T = Record<string, unknown>>(sql: string) {
      return db.prepare(sql).all() as T[];
    }
  });
}

describe("migrations", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
  });

  afterEach(() => {
    db.close();
  });

  it("runs all migration SQL statements in order", async () => {
    const executed: string[] = [];
    await runMigrations({
      async execute(sql: string) {
        executed.push(sql);
      },
      async query() {
        return [];
      }
    });

    expect(executed[0]).toContain("CREATE TABLE IF NOT EXISTS schema_versions");
    const migrationStatements = executed.filter((sql) => MIGRATIONS.includes(sql));
    expect(migrationStatements).toEqual(MIGRATIONS);
  });

  it("executes DDL on sqlite and creates required tables", async () => {
    await applyMigrations(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);

    expect(tables).toEqual(expect.arrayContaining(["projects", "project_channels", "threads", "turns", "audit_logs"]));
  });

  it("enforces unique constraints and supports transaction rollback", async () => {
    await applyMigrations(db);

    db.exec("BEGIN TRANSACTION");
    try {
      db
        .prepare(
          `INSERT INTO projects (id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("proj-1", "org-1", "payment-api", "/repos/payment", "workspace-write", "on-request", "active");

      db
        .prepare(
          `INSERT INTO projects (id, org_id, name, default_cwd, sandbox_mode, approval_policy, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run("proj-2", "org-1", "payment-api", "/repos/another", "workspace-write", "on-request", "active");

      db.exec("COMMIT");
    } catch {
      db.exec("ROLLBACK");
    }

    const count = db.prepare("SELECT COUNT(*) AS total FROM projects").get() as { total: number };
    expect(count.total).toBe(0);

    db
      .prepare(
        `INSERT INTO threads (id, project_id, chat_id, codex_thread_id, status)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run("thread-local-1", "proj-1", "chat-1", "thr-1", "active");

    expect(() =>
      db
        .prepare(
          `INSERT INTO threads (id, project_id, chat_id, codex_thread_id, status)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run("thread-local-2", "proj-1", "chat-1", "thr-2", "active")
    ).toThrowError(/UNIQUE constraint failed/);
  });

  it("tracks applied migration versions", async () => {
    await applyMigrations(db);
    await applyMigrations(db);

    const versions = db
      .prepare("SELECT version FROM schema_versions ORDER BY version ASC")
      .all()
      .map((row) => (row as { version: number }).version);

    expect(versions).toEqual(Array.from({ length: MIGRATIONS.length }, (_, index) => index + 1));
  });

  it("skips already applied migration SQL on rerun", async () => {
    const applied = new Set<number>();
    const executedMigrations: string[] = [];

    const executor = {
      async execute(sql: string) {
        if (MIGRATIONS.includes(sql)) {
          executedMigrations.push(sql);
        }
        const versionMatch = sql.match(/VALUES \((\d+), CURRENT_TIMESTAMP\)/);
        if (versionMatch) {
          applied.add(Number(versionMatch[1]));
        }
      },
      async query<T = Record<string, unknown>>(_sql: string) {
        return [...applied].map((version) => ({ version })) as T[];
      }
    };

    await runMigrations(executor);
    await runMigrations(executor);

    expect(executedMigrations).toEqual(MIGRATIONS);
  });
});
