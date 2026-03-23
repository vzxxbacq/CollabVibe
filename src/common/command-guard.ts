/**
 * @module src/common/command-guard
 * @layer L1 (platform-agnostic shared)
 *
 * Intent → Permission mapping and authorization.
 * Permission model (Permission type, RolePermissionMap, hasPermission, authorize)
 * is defined in L2 (services/iam/) — single source of truth.
 * This module only owns the IntentType → Permission mapping.
 */
import type { IntentType } from "./intent-types";
import type { EffectiveRole, Permission } from "../../services/index";
import { authorize } from "../../services/index";

// ── Intent → Permission mapping ───────────────────────────────────────

export const IntentPermissionMap: Record<IntentType, Permission> = {
  PROJECT_CREATE: "system.admin",
  ADMIN_HELP:     "system.admin",
  PROJECT_LIST:   "project.read",
  SNAPSHOT_LIST:  "project.read",
  THREAD_NEW:     "thread.manage",
  THREAD_SWITCH:  "thread.manage",
  THREAD_LIST:    "thread.manage",
  THREAD_MERGE:   "thread.merge",
  TURN_START:     "turn.operate",
  TURN_INTERRUPT: "turn.operate",
  SKILL_LIST:     "skill.use",
  SKILL_INSTALL:  "skill.manage",
  SKILL_REMOVE:   "skill.manage",
  SKILL_ADMIN:    "skill.manage",
  MODEL_LIST:     "config.write",
  USER_LIST:      "user.read",
  USER_ROLE:      "system.admin",
  USER_ADD:       "system.admin",
  USER_REMOVE:    "system.admin",
  ADMIN_ADD:      "system.admin",
  ADMIN_REMOVE:   "system.admin",
  ADMIN_LIST:     "system.admin",
  HELP:           "help.read",
  UNKNOWN:        "help.read",
};

// ── Authorization function ────────────────────────────────────────────

/**
 * authorizeIntent — deny-by-default intent authorization.
 * Every intent is mapped; unmapped intents cause compile errors.
 */
export function authorizeIntent(role: EffectiveRole | null | undefined, intent: IntentType): void {
  const permission = IntentPermissionMap[intent];
  authorize(role, permission);
}
