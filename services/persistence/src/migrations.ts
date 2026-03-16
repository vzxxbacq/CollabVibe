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
  );`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    approval_type TEXT NOT NULL,
    decision TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    secret_key TEXT NOT NULL,
    cipher_text TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(org_id, secret_key)
  );`,
  `CREATE TABLE IF NOT EXISTS user_thread_bindings (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    codex_thread_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(chat_id, user_id)
  );`,
  `ALTER TABLE audit_logs ADD COLUMN trace_id TEXT;`,
  `ALTER TABLE audit_logs ADD COLUMN detail_json TEXT;`,
  `ALTER TABLE audit_logs ADD COLUMN org_id TEXT;`,
  `CREATE TABLE IF NOT EXISTS chat_threads (
    chat_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    codex_thread_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(chat_id, thread_name)
  );`,
  `CREATE TABLE IF NOT EXISTS turn_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    user_id TEXT,
    cwd TEXT NOT NULL,
    git_ref TEXT NOT NULL,
    agent_summary TEXT,
    files_changed TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(chat_id, thread_id, turn_id)
  );`,
  `ALTER TABLE chat_threads ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`,
  // Migration: change PK from (chat_id, thread_name) to codex_thread_id
  `CREATE TABLE IF NOT EXISTS chat_threads_v2 (
    codex_thread_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );`,
  `INSERT OR IGNORE INTO chat_threads_v2 (codex_thread_id, chat_id, thread_name, created_at, status)
   SELECT codex_thread_id, chat_id, thread_name, created_at, COALESCE(status, 'active') FROM chat_threads;`,
  `DROP TABLE IF EXISTS chat_threads;`,
  `ALTER TABLE chat_threads_v2 RENAME TO chat_threads;`,
  `CREATE TABLE IF NOT EXISTS skill_allowlist (
    source TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    name TEXT,
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL,
    description TEXT
  );`,
  `ALTER TABLE user_thread_bindings ADD COLUMN agent_thread_id TEXT;`,
  `ALTER TABLE user_thread_bindings ADD COLUMN backend_name TEXT NOT NULL DEFAULT 'codex';`,
  `ALTER TABLE user_thread_bindings ADD COLUMN transport TEXT NOT NULL DEFAULT 'codex';`,
  `ALTER TABLE user_thread_bindings ADD COLUMN model TEXT;`,
  `UPDATE user_thread_bindings
   SET agent_thread_id = COALESCE(agent_thread_id, codex_thread_id)
   WHERE agent_thread_id IS NULL;`,
  `ALTER TABLE chat_threads ADD COLUMN agent_thread_id TEXT;`,
  `ALTER TABLE chat_threads ADD COLUMN backend_name TEXT NOT NULL DEFAULT 'codex';`,
  `ALTER TABLE chat_threads ADD COLUMN transport TEXT NOT NULL DEFAULT 'codex';`,
  `ALTER TABLE chat_threads ADD COLUMN model TEXT;`,
  `UPDATE chat_threads
   SET agent_thread_id = COALESCE(agent_thread_id, codex_thread_id)
   WHERE agent_thread_id IS NULL;`,
  `CREATE TABLE IF NOT EXISTS chat_threads_v3 (
    agent_thread_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    backend_name TEXT NOT NULL DEFAULT 'codex',
    transport TEXT NOT NULL DEFAULT 'codex',
    model TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );`,
  `INSERT OR IGNORE INTO chat_threads_v3 (agent_thread_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
   SELECT COALESCE(agent_thread_id, codex_thread_id), chat_id, thread_name, COALESCE(backend_name, 'codex'), COALESCE(transport, 'codex'), model, created_at, COALESCE(status, 'active')
   FROM chat_threads;`,
  `DROP TABLE IF EXISTS chat_threads;`,
  `ALTER TABLE chat_threads_v3 RENAME TO chat_threads;`,
  `ALTER TABLE user_thread_bindings ADD COLUMN backend_session_id TEXT;`,
  `UPDATE user_thread_bindings SET backend_session_id = COALESCE(backend_session_id, agent_thread_id) WHERE backend_session_id IS NULL;`,
  `ALTER TABLE chat_threads ADD COLUMN backend_session_id TEXT;`,
  // v4: consolidate agent_thread_id + backend_session_id → thread_id
  `CREATE TABLE IF NOT EXISTS chat_threads_v4 (
    thread_id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    backend_name TEXT NOT NULL DEFAULT 'codex',
    transport TEXT NOT NULL DEFAULT 'codex',
    model TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );`,
  `INSERT OR IGNORE INTO chat_threads_v4 (thread_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
   SELECT COALESCE(backend_session_id, agent_thread_id), chat_id, thread_name, backend_name, transport, model, created_at, status
   FROM chat_threads;`,
  `DROP TABLE IF EXISTS chat_threads;`,
  `ALTER TABLE chat_threads_v4 RENAME TO chat_threads;`,
  `CREATE TABLE IF NOT EXISTS turn_records (
    chat_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    user_id TEXT,
    trace_id TEXT,
    status TEXT NOT NULL,
    cwd TEXT NOT NULL,
    snapshot_sha TEXT,
    files_changed TEXT,
    diff_summary TEXT,
    stats_json TEXT,
    approval_required INTEGER NOT NULL DEFAULT 0,
    approval_resolved_at TEXT,
    last_agent_message TEXT,
    token_usage_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY(chat_id, turn_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_turn_records_thread ON turn_records(chat_id, thread_name, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS thread_turn_states (
    chat_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    active_turn_id TEXT,
    blocking_turn_id TEXT,
    last_completed_turn_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(chat_id, thread_name)
  );`,
  `ALTER TABLE user_thread_bindings ADD COLUMN project_id TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS user_thread_bindings_v2 (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    codex_thread_id TEXT,
    backend_session_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, user_id)
  );`,
  `INSERT OR REPLACE INTO user_thread_bindings_v2 (project_id, chat_id, user_id, thread_name, codex_thread_id, backend_session_id, updated_at)
   SELECT COALESCE(NULLIF(project_id, ''), chat_id, ''), chat_id, user_id, thread_name, codex_thread_id, backend_session_id, updated_at
   FROM user_thread_bindings;`,
  `DROP TABLE IF EXISTS user_thread_bindings;`,
  `ALTER TABLE user_thread_bindings_v2 RENAME TO user_thread_bindings;`,
  `ALTER TABLE chat_threads ADD COLUMN project_id TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS chat_threads_v5 (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    backend_name TEXT NOT NULL DEFAULT 'codex',
    transport TEXT NOT NULL DEFAULT 'codex',
    model TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );`,
  `INSERT OR REPLACE INTO chat_threads_v5 (thread_id, project_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
   SELECT thread_id, COALESCE(NULLIF(project_id, ''), chat_id, ''), chat_id, thread_name, backend_name, transport, model, created_at, status
   FROM chat_threads;`,
  `DROP TABLE IF EXISTS chat_threads;`,
  `ALTER TABLE chat_threads_v5 RENAME TO chat_threads;`,
  `ALTER TABLE turn_snapshots ADD COLUMN project_id TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS turn_snapshots_v2 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    turn_index INTEGER NOT NULL,
    user_id TEXT,
    cwd TEXT NOT NULL,
    git_ref TEXT NOT NULL,
    agent_summary TEXT,
    files_changed TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(project_id, thread_id, turn_id)
  );`,
  `INSERT OR IGNORE INTO turn_snapshots_v2 (project_id, chat_id, thread_id, turn_id, turn_index, user_id, cwd, git_ref, agent_summary, files_changed, created_at)
   SELECT COALESCE(NULLIF(project_id, ''), chat_id, ''), chat_id, thread_id, turn_id, turn_index, user_id, cwd, git_ref, agent_summary, files_changed, created_at
   FROM turn_snapshots;`,
  `DROP TABLE IF EXISTS turn_snapshots;`,
  `ALTER TABLE turn_snapshots_v2 RENAME TO turn_snapshots;`,
  `CREATE TABLE IF NOT EXISTS turn_records_v2 (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    user_id TEXT,
    trace_id TEXT,
    status TEXT NOT NULL,
    cwd TEXT NOT NULL,
    snapshot_sha TEXT,
    files_changed TEXT,
    diff_summary TEXT,
    stats_json TEXT,
    approval_required INTEGER NOT NULL DEFAULT 0,
    approval_resolved_at TEXT,
    last_agent_message TEXT,
    token_usage_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY(project_id, turn_id)
  );`,
  `INSERT OR REPLACE INTO turn_records_v2 (
    project_id, chat_id, thread_name, thread_id, turn_id, user_id, trace_id, status, cwd, snapshot_sha,
    files_changed, diff_summary, stats_json, approval_required, approval_resolved_at,
    last_agent_message, token_usage_json, created_at, updated_at, completed_at
  )
   SELECT project_id, chat_id, thread_name, thread_id, turn_id, user_id, trace_id, status, cwd, snapshot_sha,
          files_changed, diff_summary, stats_json, approval_required, approval_resolved_at,
          last_agent_message, token_usage_json, created_at, updated_at, completed_at
   FROM turn_records;`,
  `DROP TABLE IF EXISTS turn_records;`,
  `ALTER TABLE turn_records_v2 RENAME TO turn_records;`,
  `CREATE INDEX IF NOT EXISTS idx_turn_records_project_thread ON turn_records(project_id, thread_name, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS turn_details (
    project_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    prompt_summary TEXT,
    backend_name TEXT,
    model_name TEXT,
    turn_mode TEXT,
    message TEXT,
    reasoning TEXT,
    tools_json TEXT,
    tool_outputs_json TEXT,
    plan_state_json TEXT,
    agent_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, turn_id),
    FOREIGN KEY(project_id, turn_id) REFERENCES turn_records(project_id, turn_id) ON DELETE CASCADE
  );`,
  `ALTER TABLE thread_turn_states ADD COLUMN project_id TEXT NOT NULL DEFAULT '';`,
  `CREATE TABLE IF NOT EXISTS thread_turn_states_v2 (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    active_turn_id TEXT,
    blocking_turn_id TEXT,
    last_completed_turn_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, thread_name)
  );`,
  `INSERT OR REPLACE INTO thread_turn_states_v2 (project_id, chat_id, thread_name, active_turn_id, blocking_turn_id, last_completed_turn_id, updated_at)
   SELECT COALESCE(NULLIF(project_id, ''), chat_id, ''), chat_id, thread_name, active_turn_id, blocking_turn_id, last_completed_turn_id, updated_at
   FROM thread_turn_states;`,
  `DROP TABLE IF EXISTS thread_turn_states;`,
  `ALTER TABLE thread_turn_states_v2 RENAME TO thread_turn_states;`,
  `CREATE TABLE IF NOT EXISTS project_threads (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    backend_name TEXT NOT NULL DEFAULT 'codex',
    transport TEXT NOT NULL DEFAULT 'codex',
    model TEXT,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
  );`,
  `INSERT OR REPLACE INTO project_threads (thread_id, project_id, chat_id, thread_name, backend_name, transport, model, created_at, status)
   SELECT thread_id, project_id, chat_id, thread_name, backend_name, transport, model, created_at, status
   FROM chat_threads;`,
  `DROP TABLE IF EXISTS chat_threads;`,
  `CREATE TABLE IF NOT EXISTS plugin_catalog (
    plugin_name TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'github-subpath',
    source_mode TEXT,
    skill_subpath TEXT,
    installer_backend TEXT,
    marketplace_name TEXT,
    display_name TEXT,
    description TEXT,
    content_path TEXT NOT NULL DEFAULT '',
    manifest_hash TEXT,
    download_status TEXT NOT NULL DEFAULT 'downloaded',
    downloaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    downloaded_by TEXT NOT NULL DEFAULT 'system'
  );`,
  `CREATE TABLE IF NOT EXISTS plugin_catalog_v2 (
    plugin_name TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    skill_subpath TEXT,
    display_name TEXT,
    description TEXT,
    content_path TEXT NOT NULL,
    manifest_hash TEXT,
    download_status TEXT NOT NULL,
    downloaded_at TEXT NOT NULL,
    downloaded_by TEXT NOT NULL
  );`,
  `INSERT OR REPLACE INTO plugin_catalog_v2 (
    plugin_name, source_type, skill_subpath, display_name, description,
    content_path, manifest_hash, download_status, downloaded_at, downloaded_by
  )
   SELECT plugin_name,
          CASE
            WHEN source_type IN ('github-subpath', 'feishu-upload', 'local', 'git', 'npm', 'url', 'claude-path', 'codex-marketplace', 'claude-marketplace')
              THEN source_type
            ELSE 'github-subpath'
          END,
          skill_subpath,
          display_name,
          description,
          content_path,
          manifest_hash,
          download_status,
          downloaded_at,
          downloaded_by
   FROM plugin_catalog;`,
  `DROP TABLE IF EXISTS plugin_catalog;`,
  `ALTER TABLE plugin_catalog_v2 RENAME TO plugin_catalog;`,
  `DROP TABLE IF EXISTS skill_allowlist;`,
  `DROP TABLE IF EXISTS project_plugin_bindings;`,
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
    try {
      await executor.execute(migration);
    } catch (error) {
      const message = String((error as Error).message ?? error);
      // Allow reruns when columns were manually added but version record is missing.
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
    await executor.execute(
      `INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (${version}, CURRENT_TIMESTAMP);`
    );
  }
}
