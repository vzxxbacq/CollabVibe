import { mkdirSync } from "node:fs";
import path from "node:path";

import { AsyncDatabaseProxy } from "./async-database-proxy";
import type { DatabaseOptions } from "./async-database-proxy";
import { runMigrations } from "./migrations";

export type { DatabaseOptions } from "./async-database-proxy";

export async function createDatabase(filePath: string, options: DatabaseOptions = {}): Promise<AsyncDatabaseProxy> {
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });

  const db = await AsyncDatabaseProxy.create(filePath, options);

  await runMigrations({
    async execute(sql: string) {
      await db.exec(sql);
    },
    async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
      return await db.all(sql) as T[];
    }
  });

  return db;
}
