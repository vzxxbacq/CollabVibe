---
title: "Data and Storage"
layer: operations
status: active
---

# Data and Storage

![Data and storage placeholder](/placeholders/guide-image-placeholder.svg)

> Placeholder: add a relationship diagram among `SQLite / config / logs / workspace`.

This chapter describes the structure of the `data/` directory, the purpose of each file or subdirectory, and migration guidance.

## Directory overview

The current `data/` structure in the repository is:

| Path | Type | Purpose |
| --- | --- | --- |
| `collabvibe.db` | Main SQLite database | Primary data file |
| `collabvibe.db-wal` | SQLite WAL file | Write-ahead log with uncheckpointed data in WAL mode |
| `collabvibe.db-shm` | SQLite SHM file | Shared-memory index file for WAL |
| `config/` | Config directory | Backend configuration and default templates |
| `logs/` | Log directory | Application runtime logs |

## SQLite file set

`createDatabase()` enables the following defaults:

- `PRAGMA journal_mode = WAL`
- `PRAGMA foreign_keys = ON`
- `PRAGMA busy_timeout = 5000`

Because of that, the database is usually a file set rather than a single file:

| File | Must migrate together? | Description |
| --- | --- | --- |
| `collabvibe.db` | Yes | Main database |
| `collabvibe.db-wal` | Recommended | Transaction log that may still contain uncheckpointed data |
| `collabvibe.db-shm` | Recommended | WAL index state |

### Migration principles

- **During online migration, do not copy only `.db`**
- For offline migration after stopping the service, copy `.db`, `.db-wal`, and `.db-shm` together
- If you have explicitly checkpointed SQLite, migrating only `.db` can work, but that is not the default recommendation

## Main SQLite tables

Current migrations create or maintain the following tables:

| Table | Purpose |
| --- | --- |
| `projects` | Project information |
| `project_channels` | Project-to-channel binding |
| `threads` | Legacy thread table kept for compatibility |
| `turns` | Turn records |
| `audit_logs` | Audit logs |
| `approvals` | Approval records |
| `secrets` | Secret storage |
| `user_thread_bindings` | User pointer to the current thread |
| `project_threads` | Project-level thread registry (chat retains only the 1:1 binding field) |
| `turn_snapshots` | Turn snapshots |
| `skill_allowlist` | Skill allowlist |
| `schema_versions` | Migration version records |

### Current effective sources of truth

| Data type | Current key persistent source |
| --- | --- |
| Thread backend identity | `project_threads` / `ThreadRecord.backend` |
| User pointer to the current thread | `user_thread_bindings` |
| Approval state | `approvals` |
| Audit records | `audit_logs` |
| Snapshot records | `turn_snapshots` |
| User roles | `users` table, managed by `SqliteUserRepository` |

> Historical migrations kept some older fields and table shapes. Startup automatically migrates them to the current version.

## `config/` directory

The current system expects the following configuration file types:

| File | Purpose |
| --- | --- |
| `config/codex.toml` | Codex backend configuration |
| `config/opencode.json` | OpenCode backend configuration |
| `config/default.gitignore` | Default ignore template |

> If the directory contains extra files such as `*_bak` or `copy`, they are usually manual backups or temporary files and should not be documented as standard configuration or relied on by deployment flows.

### Configuration directory rules

| Rule | Description |
| --- | --- |
| Backend config is managed by `BackendConfigService` | Synchronized into the backend registry at startup |
| File format depends on the backend | TOML and JSON are both present today |
| Backup files may exist | But they should not be mistaken for active configuration |

## `logs/` directory

Current default log files:

| File | Purpose |
| --- | --- |
| `logs/app.log` | Main runtime log |

### Log initialization logic

- `src/server.ts` initializes file logging outside test environments
- The log directory is created by default via `createFileLogSink({ dir: "logs" })`

## Migration scenarios

### Scenario 1: migrate to another machine

Recommended steps:

| Step | Action |
| --- | --- |
| 1 | Stop the service |
| 2 | Copy `collabvibe.db`, `collabvibe.db-wal`, and `collabvibe.db-shm` |
| 3 | Copy the entire `config/` directory |
| 4 | If you need historical logs, copy `logs/` |
| 5 | Copy `.env` or reconfigure environment variables |
| 6 | Confirm `COLLABVIBE_WORKSPACE_CWD` is valid on the new machine |
| 7 | Start the service; migrations run automatically |

### Scenario 2: migrate only the database, not logs

This is possible, but you still need to migrate:

- `collabvibe.db*`
- `config/`
- `.env`

Logs are not required for state recovery, but the database and configuration are.

### Scenario 3: upgrade the code version

Recommended steps:

| Step | Action |
| --- | --- |
| 1 | Back up the entire `data/` directory |
| 2 | Update the code |
| 3 | Start the service |
| 4 | Let `runMigrations()` fill in the schema automatically |
| 5 | Verify that thread, approval, audit, and snapshot behavior is normal |

## Backup recommendations

| Category | Recommendation |
| --- | --- |
| Database | Regularly back up `collabvibe.db*` |
| Backend config | Version or back up `config/` |
| Logs | Rotate and archive as needed |
| Workspace | Back up separately as needed by the project; do not treat it as the same class as `data/` |

## Post-migration validation

| Check | Description |
| --- | --- |
| Service can start | Migration executes normally |
| Threads can recover | `project_threads` and `user_thread_bindings` are valid |
| Backend is usable | `config/` is read correctly |
| Approvals and audit are queryable | Main database data is complete |
| Logs are writable | `logs/` permissions are correct |
