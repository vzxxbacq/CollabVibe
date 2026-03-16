/**
 * @module services/persistence/src/sqlite-user-repository
 * @layer Services (persistence)
 *
 * SQLite implementation of `UserRepository`.
 *
 * ## Import Constraints
 * ✅ May import: packages/*
 * ❌ Must NOT import: src/, other services/*
 */
import type { DatabaseSync } from "node:sqlite";
import type { UserRecord, UserRepository } from "../../../packages/channel-core/src/user-repository";

interface UserRow {
  user_id: string;
  sys_role: number;
  source: string;
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: DatabaseSync) {
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS users (
        user_id    TEXT PRIMARY KEY,
        sys_role   INTEGER NOT NULL DEFAULT 0,
        source     TEXT    NOT NULL DEFAULT 'im',
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );`
    );
  }

  /**
   * Seed env admin identities on startup.
   * Idempotent upsert — existing env admins are left unchanged,
   * runtime admins whose id matches an env id are upgraded to source='env'.
   */
  seedEnvAdmins(envIds: string[]): void {
    const stmt = this.db.prepare(
      `INSERT INTO users (user_id, sys_role, source)
       VALUES (?, 1, 'env')
       ON CONFLICT(user_id)
       DO UPDATE SET sys_role = 1, source = 'env'`
    );
    for (const id of envIds) {
      stmt.run(id);
    }
  }

  isAdmin(userId: string): boolean {
    const row = this.db
      .prepare("SELECT sys_role FROM users WHERE user_id = ?")
      .get(userId) as { sys_role: number } | undefined;
    return row?.sys_role === 1;
  }

  listAdmins(): UserRecord[] {
    const rows = this.db
      .prepare("SELECT user_id, sys_role, source FROM users WHERE sys_role = 1 ORDER BY source, user_id")
      .all() as unknown as UserRow[];
    return rows.map(r => ({
      userId: r.user_id,
      sysRole: 1 as const,
      source: r.source as "env" | "im",
    }));
  }

  setAdmin(userId: string, source: "env" | "im"): void {
    this.db
      .prepare(
        `INSERT INTO users (user_id, sys_role, source)
         VALUES (?, 1, ?)
         ON CONFLICT(user_id)
         DO UPDATE SET sys_role = 1, source = ?`
      )
      .run(userId, source, source);
  }

  removeAdmin(userId: string): { ok: boolean; reason?: string } {
    // Check current record
    const row = this.db
      .prepare("SELECT source FROM users WHERE user_id = ? AND sys_role = 1")
      .get(userId) as { source: string } | undefined;

    if (!row) {
      return { ok: false, reason: "用户不是管理员" };
    }

    if (row.source === "env") {
      return { ok: false, reason: "env 种子管理员不可删除" };
    }

    this.db
      .prepare("UPDATE users SET sys_role = 0 WHERE user_id = ?")
      .run(userId);
    return { ok: true };
  }

  ensureUser(userId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (user_id, sys_role, source)
         VALUES (?, 0, 'im')`
      )
      .run(userId);
  }

  listAll(opts?: { offset?: number; limit?: number; userIds?: string[] }): { users: UserRecord[]; total: number } {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;
    const userIds = opts?.userIds;

    let whereClause = "";
    const params: string[] = [];
    if (userIds && userIds.length > 0) {
      whereClause = `WHERE user_id IN (${userIds.map(() => "?").join(", ")})`;
      params.push(...userIds);
    }

    const rows = this.db
      .prepare(`SELECT user_id, sys_role, source FROM users ${whereClause} ORDER BY sys_role DESC, user_id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as unknown as UserRow[];
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as total FROM users ${whereClause}`)
      .all(...params) as unknown as Array<{ total: number }>;
    return {
      users: rows.map(r => ({
        userId: r.user_id,
        sysRole: r.sys_role as 0 | 1,
        source: r.source as "env" | "im",
      })),
      total: countRow[0]?.total ?? 0,
    };
  }
}
