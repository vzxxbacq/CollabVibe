/**
 * @module src/core
 * @layer Core (platform-agnostic)
 *
 * Barrel file for the shared core layer.
 *
 * Exports:
 * - `CoreDeps` — platform-agnostic dependency interface
 * - `dispatchIntent`, `classifyIntent` — shared intent dispatch chain
 * - 8 pure business logic functions (createProject, listProjects, etc.)
 * - Result types: ProjectCreateResult, SnapshotListResult, ModelListResult, ThreadNewFormData
 *
 * ## Architecture Rule
 * This module is the ONLY entry point for platform layers (feishu/, slack/) to access
 * shared business logic. Platform layers should import from `../core/` or `../core/index`.
 */
export type { CoreDeps } from "./types";
export { classifyIntent, dispatchIntent } from "./intent-dispatcher";
export type { IntentDispatchResult, IntentParams } from "./intent-dispatcher";
export {
  createProject, listProjects, listSkills, installSkill, removeSkill,
  listSnapshots, resolveModelList, resolveThreadNewFormData
} from "./platform-commands";
export type {
  ProjectCreateResult, SnapshotListResult, ModelListResult, ThreadNewFormData
} from "./platform-commands";
