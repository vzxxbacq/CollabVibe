/**
 * @module services/persistence/sqlite-user-repository
 * @layer Services (persistence)
 *
 * SQLite implementation of `UserRepository`.
 *
 * ## Import Constraints
 * ✅ May import: packages/*
 * ❌ Must NOT import: src/, other services/*
 */
import type { AsyncDatabaseProxy } from "./async-database-proxy";
import type { UserRecord, UserRepository } from "../iam/user-repository";

interface UserRow {
  user_id: string;
  sys_role: number;
  source: string;
}

export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: AsyncDatabaseProxy) {}

  /** Must be called after construction to create table schema. */
  async init(): Promise<void> {
    await this.db.exec(
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
  async seedEnvAdmins(envIds: string[]): Promise<void> {
    for (const id of envIds) {
      await this.db.run(
        `INSERT INTO users (user_id, sys_role, source)
         VALUES (?, 1, 'env')
         ON CONFLICT(user_id)
         DO UPDATE SET sys_role = 1, source = 'env'`,
        id,
      );
    }
  }

  async isAdmin(userId: string): Promise<boolean> {
    const row = await this.db.get(
      "SELECT sys_role FROM users WHERE user_id = ?",
      userId,
    ) as { sys_role: number } | undefined;
    return row?.sys_role === 1;
  }

  async listAdmins(): Promise<UserRecord[]> {
    const rows = await this.db.all(
      "SELECT user_id, sys_role, source FROM users WHERE sys_role = 1 ORDER BY source, user_id",
    ) as UserRow[];
    return rows.map(r => ({
      userId: r.user_id,
      sysRole: 1 as const,
      source: r.source as "env" | "im",
    }));
  }

  async setAdmin(userId: string, source: "env" | "im"): Promise<void> {
    await this.db.run(
      `INSERT INTO users (user_id, sys_role, source)
       VALUES (?, 1, ?)
       ON CONFLICT(user_id)
       DO UPDATE SET sys_role = 1, source = ?`,
      userId, source, source,
    );
  }

  async removeAdmin(userId: string): Promise<{ ok: boolean; reason?: string }> {
    const row = await this.db.get(
      "SELECT source FROM users WHERE user_id = ? AND sys_role = 1",
      userId,
    ) as { source: string } | undefined;

    if (!row) {
      return { ok: false, reason: "用户不是管理员" };
    }

    if (row.source === "env") {
      return { ok: false, reason: "env 种子管理员不可删除" };
    }

    await this.db.run(
      "UPDATE users SET sys_role = 0 WHERE user_id = ?",
      userId,
    );
    return { ok: true };
  }

  async ensureUser(userId: string): Promise<void> {
    await this.db.run(
      `INSERT OR IGNORE INTO users (user_id, sys_role, source)
       VALUES (?, 0, 'im')`,
      userId,
    );
  }

  async listAll(opts?: { offset?: number; limit?: number; userIds?: string[] }): Promise<{ users: UserRecord[]; total: number }> {
    const limit = opts?.limit ?? 20;
    const offset = opts?.offset ?? 0;
    const userIds = opts?.userIds;

    let whereClause = "";
    const params: (string | number)[] = [];
    if (userIds && userIds.length > 0) {
      whereClause = `WHERE user_id IN (${userIds.map(() => "?").join(", ")})`;
      params.push(...userIds);
    }

    const rows = await this.db.all(
      `SELECT user_id, sys_role, source FROM users ${whereClause} ORDER BY sys_role DESC, user_id LIMIT ? OFFSET ?`,
      ...params, limit, offset,
    ) as UserRow[];
    const countRows = await this.db.all(
      `SELECT COUNT(*) as total FROM users ${whereClause}`,
      ...params,
    ) as Array<{ total: number }>;
    return {
      users: rows.map(r => ({
        userId: r.user_id,
        sysRole: r.sys_role as 0 | 1,
        source: r.source as "env" | "im",
      })),
      total: countRows[0]?.total ?? 0,
    };
  }
}
