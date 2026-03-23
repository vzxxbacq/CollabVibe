export const ResultMode = {
  THREAD_NEW_FORM: "thread-new-form",
  THREAD_CREATED:  "thread-created",
  THREAD_JOINED:   "thread-joined",
  THREAD_RESUMED:  "thread-resumed",
  THREAD_LIST:     "thread-list",
  MERGE_PREVIEW:   "merge-preview",
  MERGE_CONFLICT:  "merge-conflict",
  MERGE_SUCCESS:   "merge-success",
  MERGE_FILE_REVIEW: "merge-file-review",
  MERGE_SUMMARY:   "merge-summary",
  MERGE_RESOLVING: "merge-resolving",
  THREAD_SYNC_TEXT: "thread-sync-text",
  TURN:            "turn",
} as const;

export type ResultModeValue = (typeof ResultMode)[keyof typeof ResultMode];

export type { MergeDiffStats } from "../../../../packages/git-utils/src/merge";
import type { MergeDiffStats } from "../../../../packages/git-utils/src/merge";
import type { IMFileMergeReview, IMMergeSummary } from "../../../contracts/im/im-output";

export type HandleIntentResult =
  | { mode: typeof ResultMode.THREAD_NEW_FORM; id: string }
  | { mode: typeof ResultMode.THREAD_CREATED; id: string; threadName: string }
  | { mode: typeof ResultMode.THREAD_JOINED; id: string; threadName: string }
  | { mode: typeof ResultMode.THREAD_RESUMED; id: string; threadName: string }
  | { mode: typeof ResultMode.THREAD_LIST; id: string }
  | { mode: typeof ResultMode.MERGE_PREVIEW; id: string; baseBranch?: string; diffStats?: MergeDiffStats }
  | { mode: typeof ResultMode.MERGE_CONFLICT; id: string; baseBranch?: string; conflicts?: string[]; resolverThread?: { threadName: string; threadId: string; turnId?: string }; message?: string }
  | { mode: typeof ResultMode.MERGE_SUCCESS; id: string; baseBranch?: string; message?: string }
  | { mode: typeof ResultMode.MERGE_FILE_REVIEW; id: string; fileReview: IMFileMergeReview }
  | { mode: typeof ResultMode.MERGE_SUMMARY; id: string; mergeSummary: IMMergeSummary }
  | { mode: typeof ResultMode.MERGE_RESOLVING; id: string; conflicts: string[] }
  | { mode: typeof ResultMode.THREAD_SYNC_TEXT; id: string; text: string }
  | { mode: typeof ResultMode.TURN; id: string };
