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
 *
 * ProjectRole / EffectiveRole 定义权在 services/types/iam.ts（唯一来源）。
 * Permission 枚举和 RolePermissionMap 是 L2 内部实现，保留在此文件。
 */

import type { ProjectRole, EffectiveRole } from "../types/iam";
export type { ProjectRole, EffectiveRole };

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
