// Worktree management
export { createWorktree, removeWorktree, listWorktrees, getWorktreePath } from "./worktree";

// Merge operations
export { dryRunMerge, mergeWorktree, startConflictMerge, checkConflictsResolved, unquoteGitPath,
         startMergeSession, applyFileDecision, commitMergeSession, abortMergeSession,
         fastForwardMain, commitWorktreeChanges, readCachedFileDiff, readWorktreeStatusMap } from "./merge";
export type { MergeDiffStats, DryRunMergeResult, MergeFileInfo, MergeSessionResult } from "./merge";
export type { MergeLogContext } from "./merge-log-schema";

// Snapshot management
export { createSnapshot, restoreSnapshot, diffSnapshot, pinSnapshot } from "./snapshot";
export type { DiffFile, SnapshotDiff } from "./snapshot";

// Commit and diff utilities
export { commitAndDiffWorktreeChanges, isWorktreeDirty } from "./commit";
export type { TurnDiffResult } from "./commit";

// Repository operations
export { initRepo, getRemoteUrl, setRemoteUrl, shallowClone, detectDefaultBranch, getCurrentBranch } from "./repo";
