/**
 * @module src/platform
 * @layer L1 (platform-agnostic shared)
 *
 * Barrel export for shared platform logic.
 * Feishu and Slack both import from this module.
 */

// ── Intent classification & dispatch ──
export { classifyIntent, dispatchIntent } from "./dispatcher";
export type { IntentDispatchResult, IntentParams } from "./dispatcher";

// ── Intent result types ──
export { ResultMode } from "./result";
export type { HandleIntentResult } from "./result";

// ── Platform commands (non-agent) ──
export {
  createProject,
  listProjects,
  listSkills,
  installSkill,
  removeSkill,
  listSnapshots,
  resolveModelList,
  resolveThreadNewFormData,
  handleAdminIntent,
  handleAdminIntentOutput,
  handleUserIntent,
  handleUserIntentOutput,
  toNotificationOutput,
} from "./platform-commands";
export type { CommandDeps, ProjectCreateResult, SnapshotListResult, ModelListResult, ThreadNewFormData } from "./platform-commands";

// ── Routers ──
export { PlatformActionRouter } from "./platform-action-router";
export { PlatformInputRouter } from "./platform-input-router";

// ── Command guard / authorization ──
export { authorizeIntent, IntentPermissionMap } from "./command-guard";
// Permission model (Permission, RolePermissionMap, hasPermission, authorize) → import from services/index
