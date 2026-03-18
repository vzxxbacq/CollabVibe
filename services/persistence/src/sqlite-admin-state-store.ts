import type { DatabaseSync } from "node:sqlite";

import type { AdminPersistedState, AdminStateStore } from "../../contracts/admin/contracts";

interface AdminStateRow {
  state_json: string;
}

const EMPTY_STATE: AdminPersistedState = {
  wizardStep: {},
  projects: [],
  members: {}
};

function normalizeState(state: AdminPersistedState): AdminPersistedState {
  return {
    wizardStep: state.wizardStep ?? {},
    members: state.members ?? {},
    projects: (state.projects ?? []).map((project) => ({
      ...project,
      enabledSkills: Array.isArray((project as { enabledSkills?: unknown }).enabledSkills)
        ? [...new Set(((project as { enabledSkills?: unknown[] }).enabledSkills ?? [])
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0))]
        : []
    }))
  };
}

function clone<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

export class SqliteAdminStateStore implements AdminStateStore {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS admin_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL
      );`
    );
  }

  read(): AdminPersistedState {
    const row = this.db.prepare("SELECT state_json FROM admin_state WHERE id = 1").get() as AdminStateRow | undefined;
    if (!row) {
      return clone(EMPTY_STATE);
    }
    try {
      const parsed = JSON.parse(row.state_json) as AdminPersistedState;
      return clone(normalizeState(parsed));
    } catch (error) {
      throw new Error(`admin_state row is corrupted: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  write(state: AdminPersistedState): void {
    this.db
      .prepare(
        `INSERT INTO admin_state (id, state_json)
         VALUES (1, ?)
         ON CONFLICT(id)
         DO UPDATE SET state_json = excluded.state_json`
      )
      .run(JSON.stringify(normalizeState(state)));
  }
}
