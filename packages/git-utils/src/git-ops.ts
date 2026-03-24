/**
 * GitOps — L3 git operations unified injectable interface.
 *
 * L2 services/ access ALL git operations through a single `GitOps` instance
 * injected via deps. Direct imports of packages/git-utils/ sub-modules from L2
 * are prohibited (AGENTS.md §2 isolation rules).
 *
 * Production: createGitOps() returns real implementations.
 * Testing: createFakeGitOps() returns in-memory fakes.
 */

import type { MergeLogContext } from "./merge-log-schema";
import type { DryRunMergeResult, MergeFileDecision, MergeSessionResult } from "./merge";
import type { TurnDiffResult } from "./commit";
import type { SnapshotDiff } from "./snapshot";

/* ── Sub-interfaces ──────────────────────────────────────────────────── */

export interface GitWorktreeOps {
  create(mainCwd: string, branchName: string, worktreePath: string,
    options?: { pluginDirs?: string[]; baseBranch?: string }): Promise<string>;
  remove(mainCwd: string, worktreePath: string,
    branchName?: string): Promise<void>;
  getPath(mainCwd: string, threadName: string): string;
  assertValid(mainCwd: string, worktreePath: string): Promise<void>;
  list(mainCwd: string): Promise<Array<{ path: string; branch: string; head: string }>>;
  getHeadSha(cwd: string): Promise<string>;
  fastForward(worktreePath: string, targetRef: string): Promise<string>;
  fastForwardIfHeadMatches(worktreePath: string, expectedHead: string, targetRef: string): Promise<{ updated: boolean; newHead: string; reason?: string }>;
  ensurePluginSymlink(mainCwd: string, worktreePath: string,
    pluginDir: string): Promise<void>;
}

export interface GitMergeOps {
  dryRun(mainCwd: string, branchName: string,
    context?: MergeLogContext): Promise<DryRunMergeResult>;
  mergeWorktree(mainCwd: string, branchName: string, force?: boolean,
    context?: MergeLogContext): Promise<{ success: boolean; message: string; conflicts?: string[] }>;
  startConflict(worktreePath: string, branchName: string,
    context?: MergeLogContext): Promise<{ conflicts: string[] }>;
  checkResolved(worktreePath: string,
    context?: MergeLogContext): Promise<{ resolved: boolean; remaining: string[] }>;
  commitChanges(cwd: string, message: string,
    context?: MergeLogContext): Promise<boolean>;
  readStatusMap(cwd: string,
    context?: MergeLogContext): Promise<Record<string, string>>;
  readFileDiff(cwd: string, filePath: string,
    context?: MergeLogContext): Promise<string>;
  startSession(worktreeCwd: string, baseBranch: string,
    context?: MergeLogContext): Promise<MergeSessionResult>;
  applyDecision(worktreeCwd: string, filePath: string,
    decision: MergeFileDecision, baseBranch: string,
    context?: MergeLogContext): Promise<void>;
  commitSession(worktreeCwd: string, branchName: string,
    baseBranch: string, message?: string,
    context?: MergeLogContext): Promise<{ success: boolean; message: string }>;
  abortSession(cwd: string, context?: MergeLogContext): Promise<void>;
  fastForwardMain(mainCwd: string, branchName: string, baseBranch: string,
    context?: MergeLogContext): Promise<{ success: boolean; message: string }>;
}

export interface GitSnapshotOps {
  create(cwd: string): Promise<string>;
  restore(cwd: string, sha: string): Promise<void>;
  diff(cwd: string, sha: string): Promise<SnapshotDiff>;
  pin(cwd: string, sha: string, refName: string): Promise<void>;
}

export interface GitCommitOps {
  commitAndDiff(worktreePath: string, commitMessage: string,
    context?: Record<string, unknown>): Promise<TurnDiffResult | null>;
  isDirty(worktreePath: string): Promise<boolean>;
}

export interface GitRepoOps {
  init(cwd: string, cloneUrl?: string): Promise<void>;
  getCurrentBranch(cwd: string): Promise<string>;
  detectDefaultBranch(cwd: string): Promise<string>;
  ensureWorkBranch(cwd: string, branchName: string, fromBranch: string): Promise<void>;
  setRemoteUrl(cwd: string, url: string): Promise<void>;
  getRemoteUrl(cwd: string): Promise<string | null>;
  shallowClone(source: string, targetDir: string): Promise<void>;
  push(cwd: string, branchName: string, remote?: string): Promise<void>;
  isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean>;
}

/* ── Unified interface ───────────────────────────────────────────────── */

export interface GitOps {
  worktree: GitWorktreeOps;
  merge: GitMergeOps;
  snapshot: GitSnapshotOps;
  commit: GitCommitOps;
  repo: GitRepoOps;
  /** Filesystem access check (replaces `import { access } from "node:fs/promises"` in L2). */
  accessCheck(path: string): Promise<void>;
}

/* ── Default (real) implementation ───────────────────────────────────── */

import {
  createWorktree, removeWorktree, getWorktreePath, assertWorktreeValid,
  listWorktrees, getHeadSha, fastForwardWorktree, fastForwardWorktreeIfHeadMatches, ensurePluginSymlink,
} from "./worktree";
import {
  dryRunMerge, mergeWorktree, startConflictMerge, checkConflictsResolved,
  startMergeSession, applyFileDecision, commitMergeSession, abortMergeSession,
  fastForwardMain, commitWorktreeChanges, readCachedFileDiff, readWorktreeStatusMap,
} from "./merge";
import { createSnapshot, restoreSnapshot, diffSnapshot, pinSnapshot } from "./snapshot";
import { commitAndDiffWorktreeChanges, isWorktreeDirty } from "./commit";
import {
  initRepo, getCurrentBranch, detectDefaultBranch, ensureWorkBranch,
  setRemoteUrl, getRemoteUrl, shallowClone, pushBranch, isAncestor,
} from "./repo";
import { access } from "node:fs/promises";
import { initDefaultExcludes } from "./default-excludes";

/**
 * Create the default GitOps using real git implementations.
 * Called once in composition root and injected into all L2 services.
 *
 * @param workspaceCwd Absolute path to the workspace root directory.
 *   Reserved for startup compatibility; git excludes now resolve from the
 *   project-root `.gitignore` based on each command cwd.
 */
export function createGitOps(workspaceCwd: string): GitOps {
  initDefaultExcludes(workspaceCwd);
  return {
    worktree: {
      create: createWorktree,
      remove: removeWorktree,
      getPath: getWorktreePath,
      assertValid: assertWorktreeValid,
      list: listWorktrees,
      getHeadSha,
      fastForward: fastForwardWorktree,
      fastForwardIfHeadMatches: fastForwardWorktreeIfHeadMatches,
      ensurePluginSymlink,
    },
    merge: {
      dryRun: dryRunMerge,
      mergeWorktree,
      startConflict: startConflictMerge,
      checkResolved: checkConflictsResolved,
      commitChanges: commitWorktreeChanges,
      readStatusMap: readWorktreeStatusMap,
      readFileDiff: readCachedFileDiff,
      startSession: startMergeSession,
      applyDecision: applyFileDecision,
      commitSession: commitMergeSession,
      abortSession: abortMergeSession,
      fastForwardMain,
    },
    snapshot: {
      create: createSnapshot,
      restore: restoreSnapshot,
      diff: diffSnapshot,
      pin: pinSnapshot,
    },
    commit: {
      commitAndDiff: commitAndDiffWorktreeChanges,
      isDirty: isWorktreeDirty,
    },
    repo: {
      init: initRepo,
      getCurrentBranch,
      detectDefaultBranch,
      ensureWorkBranch,
      setRemoteUrl,
      getRemoteUrl,
      shallowClone,
      push: pushBranch,
      isAncestor,
    },
    accessCheck: access,
  };
}
