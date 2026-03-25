/**
 * @module services/iam/src/role-resolver
 * @layer IAM Service (shared)
 *
 * Centralized role resolution service — the single source of truth for
 * determining a user's EffectiveRole.
 *
 * ## Resolution logic
 * 1. UserRepository.isAdmin() → "admin" (system-level, from users table)
 * 2. Project member lookup → persisted ProjectRole (maintainer | developer | auditor)
 * 3. Unknown user → "auditor"
 *
 * ## Import Constraints
 * ✅ May import: packages/*
 * ❌ Must NOT import: src/, services/admin-api
 */
import type { UserRepository } from "../iam/user-repository";
import type { EffectiveRole } from "./permissions";

export interface RoleResolveOptions {
  /** Reserved for compatibility; role resolution is read-only. */
  autoRegister?: boolean;
}

/**
 * Structural type for project-member state access.
 * Intentionally does NOT import AdminStateStore to avoid cross-service imports.
 */
interface ProjectMemberState {
  read(): Promise<{ members: Record<string, Array<{ userId: string; role: string }>> }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(state: any): Promise<void>;
}

export class RoleResolver {
  constructor(
    private readonly userRepo: UserRepository,
    private readonly stateStore: ProjectMemberState
  ) {}

  /**
   * Resolve a user's effective role.
   *
   * @param userId    - The user's open_id
   * @param projectId - Project context (null → system-level only, returns admin or auditor)
   * @param opts      - Compatibility-only options; ignored
   */
  async resolve(userId: string, projectId?: string | null, opts?: RoleResolveOptions): Promise<EffectiveRole> {
    void opts;
    // 1. System admin check (highest priority)
    if (await this.userRepo.isAdmin(userId)) return "admin";

    // 2. No project context → auditor
    if (!projectId) return "auditor";

    // 3. Project member lookup
    const state = await this.stateStore.read();
    const memberRole = state.members[projectId]?.find(m => m.userId === userId)?.role;
    if (memberRole) return memberRole as EffectiveRole;

    // 4. Unknown user → fallback to the lowest effective project role
    return "auditor";
  }

  /** Check if a user is a system administrator. */
  async isAdmin(userId: string): Promise<boolean> {
    return await this.userRepo.isAdmin(userId);
  }
}
