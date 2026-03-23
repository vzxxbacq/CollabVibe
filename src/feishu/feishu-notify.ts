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
import type { AppLocale } from "../common/app-locale";
import { getFeishuNotifyStrings } from "./feishu-notify.strings";

export async function notify(
  deps: FeishuHandlerDeps, chatId: string, text: string
): Promise<void> {
  await deps.feishuAdapter.sendMessage({ chatId, text });
}

export function getFeishuNotifyCatalog(locale: AppLocale) {
  const strings = getFeishuNotifyStrings(locale);
  return {
    GUARD: {
      NOT_YOUR_CARD: strings.notYourCard,
      NO_PERMISSION: strings.noPermission,
      PENDING_APPROVAL: (name: string) => strings.pendingApproval(name),
      THREAD_RUNNING: (name: string) => strings.threadRunning(name),
    },
    OP: {
      FALLBACK_HELP: strings.fallbackHelp,
      PROJECT_CREATED: (p: { name: string; id: string; cwd: string }) => strings.projectCreated(p),
      PROJECT_LIST: (lines: string[]) => strings.projectList(lines),
      NO_PROJECTS: strings.noProjects,
      NO_THREADS: strings.noThreads,
      SNAPSHOT_EMPTY_THREAD: (name: string) => strings.snapshotEmptyThread(name),
      SNAPSHOT_EMPTY_MERGE: strings.snapshotEmptyMerge,
      SKILL_SOURCE_MISSING: strings.skillSourceMissing,
    },
    ERR: {
      generic: (msg: string) => strings.genericError(msg),
      projectCreate: (msg: string) => strings.projectCreateError(msg),
      threadCreate: (msg: string) => strings.threadCreateError(msg),
      switchFailed: (msg: string) => strings.switchFailed(msg),
      jumpFailed: (msg: string) => strings.jumpFailed(msg),
      mergePreview: (msg: string) => strings.mergePreviewError(msg),
      skillInstall: (msg: string) => strings.skillInstallError(msg),
      skillRemove: (msg: string) => strings.skillRemoveError(msg),
      pathValidation: (msg: string) => strings.pathValidationError(msg),
    },
    ORCHESTRATOR_ERROR_MAP: strings.orchestratorErrors,
  } as const;
}
