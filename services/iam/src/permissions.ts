/**
 * @module services/iam/src/permissions
 *
 * Two-dimensional permission model:
 *   1. System level: UserRepository.isAdmin() → "admin" EffectiveRole
 *   2. Project level: ProjectRole stored in adminState.members[projectId]
 *
 * admin > maintainer > developer > auditor
 *
 * NOTE: user management (USER_ADD/ROLE/REMOVE) requires system.admin.
 * Project roles do NOT grant user management ability.
 */

/** Project-level role — persisted in adminState.members[projectId] */
export type ProjectRole = "maintainer" | "developer" | "auditor";

/**
 * Effective role — the resolved role used by authorizeIntent.
 * "admin" is derived from UserRepository.isAdmin(), never stored as a ProjectRole.
 */
export type EffectiveRole = "admin" | ProjectRole;

export type Permission =
  // System-level (admin only)
  | "system.admin"
  // Project-level
  | "project.read"
  | "thread.manage"
  | "thread.merge"
  | "turn.operate"
  | "skill.use"
  | "skill.manage"
  | "approval.decide"
  | "config.write"
  | "user.read"
  | "help.read";

const ALL_PERMISSIONS: Permission[] = [
  "system.admin",
  "project.read",
  "thread.manage",
  "thread.merge",
  "turn.operate",
  "skill.use",
  "skill.manage",
  "approval.decide",
  "config.write",
  "user.read",
  "help.read"
];

export const RolePermissionMap: Record<EffectiveRole, Permission[]> = {
  admin: ALL_PERMISSIONS,
  maintainer: [
    "project.read",
    "thread.manage",
    "thread.merge",
    "turn.operate",
    "skill.use",
    "skill.manage",
    "approval.decide",
    "config.write",
    "user.read",
    "help.read"
  ],
  developer: [
    "project.read",
    "thread.manage",
    "turn.operate",
    "skill.use",
    "config.write",
    "user.read",
    "help.read"
  ],
  auditor: ["help.read"]
};
