export interface MigrationExecutor {
  execute(sql: string): Promise<void>;
  query?<T = Record<string, unknown>>(sql: string): Promise<T[]>;
}

const CURRENT_SCHEMA_VERSION = 2;

const CURRENT_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS admin_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL
  );`,

  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    backend_approval_id TEXT NOT NULL DEFAULT '',
    project_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    thread_name TEXT NOT NULL DEFAULT '',
    turn_id TEXT NOT NULL,
    call_id TEXT NOT NULL DEFAULT '',
    approval_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    decision TEXT NOT NULL DEFAULT '',
    actor_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    expired_at TEXT,
    status_reason TEXT NOT NULL DEFAULT '',
    display_json TEXT NOT NULL DEFAULT '{}'
  );`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL,
    trace_id TEXT,
    detail_json TEXT,
    org_id TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    sys_role INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'im',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );`,

  `CREATE TABLE IF NOT EXISTS user_thread_bindings (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL,
    thread_name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, user_id)
  );`,

  `CREATE TABLE IF NOT EXISTS project_threads (
    thread_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    backend_name TEXT NOT NULL DEFAULT 'codex',
    transport TEXT NOT NULL DEFAULT 'codex',
    model TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    base_sha TEXT,
    has_diverged INTEGER NOT NULL DEFAULT 0,
    worktree_path TEXT,
    execution_policy_override_json TEXT
  );`,

  `CREATE TABLE IF NOT EXISTS turn_records (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    call_id TEXT,
    platform TEXT,
    source_message_id TEXT,
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
    turn_number INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY(project_id, turn_id)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_turn_records_project_thread
   ON turn_records(project_id, thread_name, created_at DESC);`,

  `CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_records_project_call_id
   ON turn_records(project_id, call_id)
   WHERE call_id IS NOT NULL;`,

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

  `CREATE TABLE IF NOT EXISTS turn_snapshots (
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

  `CREATE TABLE IF NOT EXISTS thread_turn_states (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL DEFAULT '',
    thread_name TEXT NOT NULL,
    active_turn_id TEXT,
    blocking_turn_id TEXT,
    last_completed_turn_id TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, thread_name)
  );`,

  `CREATE TABLE IF NOT EXISTS plugin_catalog (
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

  `CREATE TABLE IF NOT EXISTS merge_sessions (
    project_id TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    base_branch TEXT NOT NULL,
    main_cwd TEXT NOT NULL,
    worktree_cwd TEXT NOT NULL,
    pre_merge_sha TEXT NOT NULL,
    files_json TEXT NOT NULL,
    current_index INTEGER NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    active_agent_file_path TEXT,
    agent_retry_baseline_json TEXT,
    trace_id TEXT,
    thread_id TEXT,
    turn_id TEXT,
    user_id TEXT,
    resolver_name TEXT,
    resolver_backend_id TEXT,
    resolver_model TEXT,
    recovery_error TEXT,
    PRIMARY KEY(project_id, branch_name)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_merge_sessions_project_state
   ON merge_sessions(project_id, state);`,
];

async function resetToCurrentSchema(executor: MigrationExecutor): Promise<void> {
  const rows = executor.query
    ? await executor.query<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_meta'`
    )
    : [];
  for (const { name } of rows) {
    await executor.execute(`DROP TABLE IF EXISTS ${name};`);
  }
  for (const sql of CURRENT_SCHEMA_SQL) {
    await executor.execute(sql);
  }
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );`
  );
  await executor.execute(
    `INSERT INTO schema_meta (id, version, updated_at)
     VALUES (1, ${CURRENT_SCHEMA_VERSION}, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       version = excluded.version,
       updated_at = excluded.updated_at;`
  );
}

export async function runMigrations(executor: MigrationExecutor): Promise<void> {
  await executor.execute(
    `CREATE TABLE IF NOT EXISTS schema_meta (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );`
  );

  const rows = executor.query
    ? await executor.query<{ version: number }>("SELECT version FROM schema_meta WHERE id = 1")
    : [];
  const currentVersion = rows[0]?.version ?? null;

  if (currentVersion !== CURRENT_SCHEMA_VERSION) {
    await resetToCurrentSchema(executor);
    return;
  }

  for (const sql of CURRENT_SCHEMA_SQL) {
    await executor.execute(sql);
  }

  const tableInfo = executor.query
    ? await executor.query<{ name: string }>("PRAGMA table_info(turn_records)")
    : [];
  const existingColumns = new Set(tableInfo.map((row) => row.name));
  if (!existingColumns.has("call_id")) {
    await executor.execute("ALTER TABLE turn_records ADD COLUMN call_id TEXT");
  }
  if (!existingColumns.has("platform")) {
    await executor.execute("ALTER TABLE turn_records ADD COLUMN platform TEXT");
  }
  if (!existingColumns.has("source_message_id")) {
    await executor.execute("ALTER TABLE turn_records ADD COLUMN source_message_id TEXT");
  }
  await executor.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_records_project_call_id
     ON turn_records(project_id, call_id)
     WHERE call_id IS NOT NULL;`
  );

  const approvalTableInfo = executor.query
    ? await executor.query<{ name: string }>("PRAGMA table_info(approvals)")
    : [];
  const approvalColumns = new Set(approvalTableInfo.map((row) => row.name));
  if (!approvalColumns.has("backend_approval_id")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN backend_approval_id TEXT NOT NULL DEFAULT ''");
  }
  if (!approvalColumns.has("thread_name")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN thread_name TEXT NOT NULL DEFAULT ''");
  }
  if (!approvalColumns.has("call_id")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN call_id TEXT NOT NULL DEFAULT ''");
  }
  if (!approvalColumns.has("status")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!approvalColumns.has("resolved_at")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN resolved_at TEXT");
  }
  if (!approvalColumns.has("expired_at")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN expired_at TEXT");
  }
  if (!approvalColumns.has("status_reason")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN status_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!approvalColumns.has("display_json")) {
    await executor.execute("ALTER TABLE approvals ADD COLUMN display_json TEXT NOT NULL DEFAULT '{}'");
  }

  // v1 → v2: add execution_policy_override_json to project_threads
  const threadTableInfo = executor.query
    ? await executor.query<{ name: string }>("PRAGMA table_info(project_threads)")
    : [];
  const threadColumns = new Set(threadTableInfo.map((row) => row.name));
  if (!threadColumns.has("execution_policy_override_json")) {
    await executor.execute("ALTER TABLE project_threads ADD COLUMN execution_policy_override_json TEXT");
  }
}
