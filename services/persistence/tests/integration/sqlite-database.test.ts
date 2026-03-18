import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { runMigrations } from "../../src/migrations";

function dbPath(name: string): string {
  return join(tmpdir(), `codex-im-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`);
}

describe("sqlite-database", () => {
  const files: string[] = [];

  afterEach(() => {
    for (const file of files) {
      rmSync(file, { force: true });
    }
    files.length = 0;
  });

  it("runs migrations idempotently", async () => {
    const db = new DatabaseSync(":memory:");
    await runMigrations({
      async execute(sql: string) {
        db.exec(sql);
      },
      async query<T = Record<string, unknown>>(sql: string) {
        return db.prepare(sql).all() as T[];
      }
    });

    const versions = db.prepare("SELECT COUNT(*) AS total FROM schema_versions").get() as { total: number };
    expect(versions.total).toBeGreaterThan(0);
    db.close();
  });

  it("[C8e-2] allows running migrations a second time without errors", async () => {
    const db = new DatabaseSync(":memory:");
    const migrationExecutor = {
      async execute(sql: string) {
        db.exec(sql);
      },
      async query<T = Record<string, unknown>>(sql: string) {
        return db.prepare(sql).all() as T[];
      }
    };

    await runMigrations(migrationExecutor);
    await expect(runMigrations(migrationExecutor)).resolves.toBeUndefined();
    db.close();
  });
});
