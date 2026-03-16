/**
 * @module src/feishu/feishu-notify
 * @layer Feishu (platform-specific)
 *
 * Centralized notification strings and helper for sending text messages.
 *
 * All user-facing notification text lives here so that updates to wording,
 * i18n, or formatting only require changes in one file.
 *
 * ## Response Type Taxonomy
 * | Type          | Abstraction                        | Location        |
 * |---------------|------------------------------------|-----------------|
 * | card_update   | `rawCard()` → SDK in-place update  | card-handler    |
 * | card_send     | `FeishuOutputAdapter.send*()`      | output-adapter  |
 * | notification  | `notify()` + constants (this file) | handlers        |
 *
 * ## Import Constraints
 * ✅ May import: src/feishu/types
 * ❌ Must NOT import: packages/channel-feishu, src/slack/
 */
import type { FeishuHandlerDeps } from "./types";
import { getFeishuNotifyStrings } from "./feishu-notify.strings";

/** Send a plain-text notification to a chat. */
const zhStrings = getFeishuNotifyStrings("zh-CN");

export async function notify(
  deps: FeishuHandlerDeps, chatId: string, text: string
): Promise<void> {
  await deps.feishuAdapter.sendMessage({ chatId, text });
}

// ── Guard notifications (permission / state checks) ─────────────────────────

export const GUARD = {
  NOT_YOUR_CARD: zhStrings.notYourCard,
  NO_PERMISSION: zhStrings.noPermission,
  PENDING_APPROVAL: (name: string) => zhStrings.pendingApproval(name),
  THREAD_RUNNING: (name: string) => zhStrings.threadRunning(name),
} as const;

// ── Operation notifications (success / guidance) ────────────────────────────

export const OP = {
  FALLBACK_HELP: zhStrings.fallbackHelp,
  PROJECT_CREATED: (p: { name: string; id: string; cwd: string }) => zhStrings.projectCreated(p),
  PROJECT_LIST: (lines: string[]) => zhStrings.projectList(lines),
  NO_PROJECTS: zhStrings.noProjects,
  NO_THREADS: zhStrings.noThreads,
  SNAPSHOT_EMPTY_THREAD: (name: string) => zhStrings.snapshotEmptyThread(name),
  SNAPSHOT_EMPTY_MERGE: zhStrings.snapshotEmptyMerge,
  SKILL_SOURCE_MISSING: zhStrings.skillSourceMissing,
} as const;

// ── Error notifications ─────────────────────────────────────────────────────

export const ERR = {
  generic: (msg: string) => zhStrings.genericError(msg),
  projectCreate: (msg: string) => zhStrings.projectCreateError(msg),
  threadCreate: (msg: string) => zhStrings.threadCreateError(msg),
  switchFailed: (msg: string) => zhStrings.switchFailed(msg),
  jumpFailed: (msg: string) => zhStrings.jumpFailed(msg),
  mergePreview: (msg: string) => zhStrings.mergePreviewError(msg),
  skillInstall: (msg: string) => zhStrings.skillInstallError(msg),
  skillRemove: (msg: string) => zhStrings.skillRemoveError(msg),
  pathValidation: (msg: string) => zhStrings.pathValidationError(msg),
} as const;

// ── Orchestrator error code → friendly message ──────────────────────────────

/** Maps OrchestratorError.code to user-facing notification text. */
export const ORCHESTRATOR_ERROR_MAP: Record<string, string> = zhStrings.orchestratorErrors;
