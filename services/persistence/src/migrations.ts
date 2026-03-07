export interface MigrationExecutor {
  execute(sql: string): Promise<void>;
  query?<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    default_cwd TEXT NOT NULL,
    sandbox_mode TEXT NOT NULL,
    approval_policy TEXT NOT NULL,
    status TEXT NOT NULL,
    UNIQUE(org_id, name)
  );`,
  `CREATE TABLE IF NOT EXISTS project_channels (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    channel_type TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    UNIQUE(project_id, channel_type, chat_id)
  );`,
  `CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    codex_thread_id TEXT NOT NULL,
    status TEXT NOT NULL,
    UNIQUE(project_id, chat_id)
  );`,
  `CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    codex_turn_id TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT
  );`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`
];

const SCHEMA_VERSIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS schema_versions (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`;

export async function runMigrations(executor: MigrationExecutor): Promise<void> {
  await executor.execute(SCHEMA_VERSIONS_TABLE_SQL);

  const applied = new Set<number>();
  if (executor.query) {
    const rows = await executor.query<{ version: number }>("SELECT version FROM schema_versions");
    for (const row of rows) {
      applied.add(Number(row.version));
    }
  }

  for (const [index, migration] of MIGRATIONS.entries()) {
    const version = index + 1;
    if (applied.has(version)) {
      continue;
    }
    await executor.execute(migration);
    await executor.execute(
      `INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (${version}, CURRENT_TIMESTAMP);`
    );
  }
}
