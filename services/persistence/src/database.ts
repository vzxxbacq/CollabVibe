import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runMigrations } from "./migrations";

export interface DatabaseOptions {
  enableWal?: boolean;
  busyTimeoutMs?: number;
}

export async function createDatabase(filePath: string, options: DatabaseOptions = {}): Promise<DatabaseSync> {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(filePath);
  if (options.enableWal !== false) {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000};`);
  db.exec("PRAGMA foreign_keys = ON;");

  await runMigrations({
    async execute(sql: string) {
      db.exec(sql);
    },
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      return db.prepare(sql).all() as T[];
    }
  });

  return db;
}
