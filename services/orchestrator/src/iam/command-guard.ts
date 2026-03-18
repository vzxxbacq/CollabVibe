import type { IntentType } from "../../../contracts/im/types";
import { authorize } from "./authorize";
import type { EffectiveRole, Permission } from "./permissions";

/**
 * Full-coverage intent → permission mapping.
 * Using Record (not Partial) ensures compile-time exhaustiveness.
 */
export const IntentPermissionMap: Record<IntentType, Permission> = {
  // System admin
  PROJECT_CREATE: "system.admin",
  ADMIN_HELP:     "system.admin",
  // Project read
  PROJECT_LIST:   "project.read",
  SNAPSHOT_LIST:  "project.read",
  // Thread management
  THREAD_NEW:     "thread.manage",
  THREAD_SWITCH:  "thread.manage",
  THREAD_LIST:    "thread.manage",
  // High-risk merge
  THREAD_MERGE:   "thread.merge",
  // Turn operations
  TURN_START:     "turn.operate",
  TURN_INTERRUPT: "turn.operate",
  // Skill
  SKILL_LIST:     "skill.use",
  SKILL_INSTALL:  "skill.manage",
  SKILL_REMOVE:   "skill.manage",
  SKILL_ADMIN:    "skill.manage",
  // Config
  MODEL_LIST:     "config.write",
  // User management (admin only)
  USER_LIST:      "user.read",
  USER_ROLE:      "system.admin",
  USER_ADD:       "system.admin",
  USER_REMOVE:    "system.admin",
  // Admin management
  ADMIN_ADD:      "system.admin",
  ADMIN_REMOVE:   "system.admin",
  ADMIN_LIST:     "system.admin",
  // Help / unknown
  HELP:           "help.read",
  UNKNOWN:        "help.read",
};

/**
 * Deny-by-default intent authorization.
 * Every intent is mapped; unmapped intents cause compile errors.
 */
export function authorizeIntent(role: EffectiveRole | null | undefined, intent: IntentType): void {
  const permission = IntentPermissionMap[intent];
  authorize(role, permission);
}
