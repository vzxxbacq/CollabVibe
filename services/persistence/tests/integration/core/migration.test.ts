import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../../src/migrations";

describe("persistence migration", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("creates approvals/secrets/user_thread_bindings and extends audit_logs columns", async () => {
    await runMigrations({
      async execute(sql: string) {
        db.exec(sql);
      },
      async query<T = Record<string, unknown>>(sql: string) {
        return db.prepare(sql).all() as T[];
      }
    });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["approvals", "secrets", "user_thread_bindings", "audit_logs"]));

    const columns = db
      .prepare("PRAGMA table_info(audit_logs)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(columns).toEqual(expect.arrayContaining(["trace_id", "detail_json", "org_id"]));

    const secretColumns = db
      .prepare("PRAGMA table_info(secrets)")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(secretColumns).toEqual(expect.arrayContaining(["cipher_text", "iv", "auth_tag"]));
  });
});
