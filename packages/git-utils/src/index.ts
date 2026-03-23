/**
 * @module git-utils — L3 公共 API
 *
 * 约定：L2 (services/) 和 L0/L1 (src/) 只能通过本文件引入 git-utils 的能力。
 *
 * - 运行时能力：通过 `createGitOps()` 获取 `GitOps` 单例注入。
 * - 类型依赖：通过 `export type` 引用数据结构（编译时擦除，不产生运行时耦合）。
 *
 * L3 内部模块（如 agent-core/transports/）可直接引用子模块，不受此约束。
 */

// ── 运行时入口（唯一） ─────────────────────────────────────────────────────
export { createGitOps } from "./git-ops";
export type { GitOps, GitWorktreeOps, GitMergeOps, GitSnapshotOps, GitCommitOps, GitRepoOps } from "./git-ops";

// ── 数据类型（纯 type，编译时擦除） ────────────────────────────────────────
export type { MergeDiffStats, DryRunMergeResult, MergeFileInfo, MergeSessionResult, MergeFileStatus, MergeFileDecision } from "./merge";
export type { MergeLogContext } from "./merge-log-schema";
export type { DiffFile, SnapshotDiff } from "./snapshot";
export type { TurnDiffResult } from "./commit";
export type { DiffFileSummary, DiffFileSegment } from "./diff-utils";

// ── Diff 解析工具（纯函数） ─────────────────────────────────────────────────
export { parseDiffFiles, splitDiffByFile, cleanDiff, formatFileTree, unquoteGitPath } from "./diff-utils";
export { parseDiffFileNames, parseDiffStats } from "./diff-parser";
