/**
 * @module packages/channel-core/src/user-repository
 * @layer Packages (底层接口)
 *
 * 系统级用户身份管理接口。
 *
 * ## 设计规则 (AGENTS.md §4 U1-U3)
 * - U1: admin 来自 env（不可删）和 im（可增删），UserRepository 统一查询
 * - U2: users 表是系统级角色唯一真实来源
 * - U3: admin 拥有全部权限，项目角色不授予用户管理
 *
 * ## Import Constraints
 * ❌ 不可 import services/ 或 src/
 */

/** A persisted user record from the `users` table. */
export interface UserRecord {
  userId: string;
  /** 0 = normal user, 1 = system admin */
  sysRole: 0 | 1;
  /** "env" = seeded from environment (immutable), "im" = added at runtime via IM command */
  source: "env" | "im";
}

/**
 * Repository interface for system-level user identity management.
 *
 * Implementations are in `services/persistence` (SQLite).
 * Consumers are in `services/iam` (RoleResolver) and `src/core` (CoreDeps).
 */
export interface UserRepository {
  /** Check whether a user is a system admin (sys_role = 1). */
  isAdmin(userId: string): boolean;

  /** List all system admins with their source annotation. */
  listAdmins(): UserRecord[];

  /** Promote a user to admin. Idempotent — if already admin, no-op. */
  setAdmin(userId: string, source: "env" | "im"): void;

  /**
   * Demote an admin to normal user.
   * env-sourced admins cannot be removed — returns `{ ok: false }`.
   */
  removeAdmin(userId: string): { ok: boolean; reason?: string };

  /** Ensure a user record exists (INSERT OR IGNORE with sys_role=0). */
  ensureUser(userId: string): void;

  /** List all registered users with optional pagination and ID filter. Admin-first ordering. */
  listAll(opts?: { offset?: number; limit?: number; userIds?: string[] }): { users: UserRecord[]; total: number };
}
