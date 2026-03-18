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
 * 3. Unknown user → "auditor" (optionally auto-registers)
 *
 * ## Import Constraints
 * ✅ May import: packages/*
 * ❌ Must NOT import: src/, services/admin-api
 */
import type { UserRepository } from "../../../contracts/admin/user-repository";
import type { EffectiveRole } from "./permissions";
import { createLogger } from "../../../../packages/logger/src/index";

const log = createLogger("role-resolver");

export interface RoleResolveOptions {
  /** If true, auto-register unknown users as "auditor" in the project */
  autoRegister?: boolean;
}

/**
 * Structural type for project-member state access.
 * Intentionally does NOT import AdminStateStore to avoid cross-service imports.
 */
interface ProjectMemberState {
  read(): { members: Record<string, Array<{ userId: string; role: string }>> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(state: any): void;
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
   * @param opts      - Options (autoRegister unknown users)
   */
  resolve(userId: string, projectId?: string | null, opts?: RoleResolveOptions): EffectiveRole {
    // 1. System admin check (highest priority)
    if (this.userRepo.isAdmin(userId)) return "admin";

    // 2. No project context → auditor
    if (!projectId) return "auditor";

    // 3. Project member lookup
    const state = this.stateStore.read();
    const memberRole = state.members[projectId]?.find(m => m.userId === userId)?.role;
    if (memberRole) return memberRole as EffectiveRole;

    // 4. Unknown user → auto-register as auditor if requested
    if (opts?.autoRegister) {
      this.autoRegister(userId, projectId);
    }
    return "auditor";
  }

  /**
   * Register an unknown user as "auditor" in the specified project.
   * Idempotent — does nothing if user already exists.
   */
  autoRegister(userId: string, projectId: string): void {
    const state = this.stateStore.read();
    if (!state.members[projectId]) state.members[projectId] = [];
    if (!state.members[projectId]!.some(m => m.userId === userId)) {
      state.members[projectId]!.push({ userId, role: "auditor" });
      this.stateStore.write(state);
      log.info({ userId, projectId }, "auto-registered user as auditor");
    }
    // Also ensure user exists in users table
    this.userRepo.ensureUser(userId);
  }

  /** Check if a user is a system administrator. */
  isAdmin(userId: string): boolean {
    return this.userRepo.isAdmin(userId);
  }
}
