import { createDatabase } from "../../../persistence/src/database";
import { SqliteThreadRegistry } from "../../../persistence/src/sqlite-thread-registry";

/**
 * Create a test ThreadRegistry backed by an in-memory SQLite database.
 * All tables are created via migrations so the schema matches production.
 */
export async function createTestThreadRegistry(): Promise<SqliteThreadRegistry> {
  const db = await createDatabase(":memory:");
  return new SqliteThreadRegistry(db);
}
