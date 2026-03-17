import { MAIN_THREAD_NAME } from "../../../../packages/agent-core/src/constants";
import { isBackendId } from "../../../../packages/agent-core/src/backend-identity";
import { createLogger } from "../../../../packages/channel-core/src/index";
import type { MergeFileStatus, MergeFileDecision, IMFileMergeReview, IMMergeSummary } from "../../../../packages/channel-core/src/im-output";
import { createSnapshot, pinSnapshot } from "../../../../packages/git-utils/src/snapshot";
import {
  getWorktreePath, mergeWorktree, removeWorktree, dryRunMerge,
  startConflictMerge, checkConflictsResolved, isWorktreeDirty,
  startMergeSession as gitStartMergeSession, applyFileDecision as gitApplyFileDecision,
  commitMergeSession as gitCommitMergeSession, abortMergeSession as gitAbortMergeSession,
  fastForwardMain as gitFastForwardMain, commitWorktreeChanges, readCachedFileDiff, getCurrentBranch, readWorktreeStatusMap
} from "../../../../packages/git-utils/src/index";
import type { MergeDiffStats, DryRunMergeResult } from "../../../../packages/git-utils/src/merge";
import type { MergeLogContext } from "../../../../packages/git-utils/src/merge-log-schema";
import { OrchestratorError, ErrorCode } from "../errors";
import type { OrchestratorContext, PendingMerge } from "../orchestrator-context";
import { buildSingleFileMergeAgentPrompt } from "./merge-agent-prompt";

const log = createLogger("merge");

/* ── Merge Session types (per-file review) ─────────────────────────────── */

interface MergeSessionFile {
  path: string;
  status: MergeFileStatus;
  diff: string;
  decision: MergeFileDecision | "pending";
  agentAttempts: number;
  lastFeedback?: string;
  agentResult?: string;
}

interface MergeSession {
  projectId: string;
  chatId: string;
  branchName: string;
  baseBranch: string;
  mainCwd: string;
  worktreeCwd: string;
  preMergeSha: string;
  files: MergeSessionFile[];
  currentIndex: number;
  state: "resolving" | "reviewing";
  createdAt: number;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  activeAgentFilePath?: string;
  agentRetryBaseline?: Record<string, string>;
  traceId?: string;
  threadId?: string;
  turnId?: string;
  userId?: string;
  resolverName?: string;
}

interface MergeRuntimeContext {
  traceId?: string;
  threadId?: string;
  turnId?: string;
  userId?: string;
  resolverName?: string;
}

function availableDecisionsForStatus(status: MergeFileStatus): MergeFileDecision[] {
  switch (status) {
    case "auto_merged":     return ["accept", "keep_main", "use_branch"];
    case "agent_resolved":  return ["accept"];  // reject+prompt is a separate button, not a decision
    case "conflict":        return ["keep_main", "use_branch"];
    case "added":           return ["accept", "skip"];
    case "deleted":         return ["accept", "keep_main"];
    default:                return ["accept", "keep_main", "use_branch"];
  }
}

function buildFileReview(session: MergeSession): IMFileMergeReview {
  const file = session.files[session.currentIndex]!;
  const accepted = session.files.filter(f => f.decision === "accept").length;
  const rejected = session.files.filter(f => f.decision !== "pending" && f.decision !== "accept").length;
  const remaining = session.files.filter(f => f.decision === "pending").length;
  return {
    kind: "file_merge_review",
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    fileIndex: session.currentIndex,
    totalFiles: session.files.length,
    file: { path: file.path, diff: file.diff, status: file.status },
    availableDecisions: availableDecisionsForStatus(file.status),
    progress: { accepted, rejected, remaining }
  };
}

function firstPendingIndex(session: MergeSession): number {
  const firstPendingConflict = session.files.findIndex((file) => file.decision === "pending" && file.status === "conflict");
  if (firstPendingConflict >= 0) {
    return firstPendingConflict;
  }
  return session.files.findIndex((file) => file.decision === "pending");
}

function buildMergeSummary(session: MergeSession): IMMergeSummary {
  const files = session.files.map(f => ({
    path: f.path,
    decision: f.decision === "pending" ? "skip" as MergeFileDecision : f.decision,
    status: f.status
  }));
  return {
    kind: "merge_summary",
    branchName: session.branchName,
    baseBranch: session.baseBranch,
    files,
    hasPartialMerge: files.some(f => f.decision !== "accept")
  };
}

export class MergeUseCase {
  private readonly pendingMerges = new Map<string, PendingMerge>();
  private readonly mergeSessions = new Map<string, MergeSession>();
  private static readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  private resolverCompleteHandler?: (info: {
    chatId: string;
    branchName: string;
    baseBranch: string;
    resolverName: string;
    traceId?: string;
    threadId?: string;
    turnId?: string;
    success: boolean;
    message: string;
    diffStats?: MergeDiffStats;
    remaining?: string[];
  }) => void;

  constructor(private readonly ctx: OrchestratorContext) { }

  onResolverComplete(handler: typeof this.resolverCompleteHandler): void {
    this.resolverCompleteHandler = handler;
  }

  private mergeKey(chatId: string, branchName: string): string {
    return `${chatId}:merge:${branchName}`;
  }

  private buildMergeContext(
    chatId: string,
    branchName: string,
    context?: MergeRuntimeContext,
    extra?: MergeLogContext
  ): MergeLogContext {
    const base: MergeLogContext = {
      chatId,
      branchName,
      ...(context?.traceId ? { traceId: context.traceId } : {}),
      ...(context?.threadId ? { threadId: context.threadId } : {}),
      ...(context?.turnId ? { turnId: context.turnId } : {}),
      ...(context?.userId ? { userId: context.userId } : {}),
      ...(context?.resolverName ? { resolverName: context.resolverName } : {}),
      ...(extra ?? {})
    };
    return Object.fromEntries(
      Object.entries(base).filter(([, value]) => value !== undefined)
    ) as MergeLogContext;
  }

  private mergeLogger(chatId: string, branchName: string, context?: MergeRuntimeContext, extra?: MergeLogContext) {
    return log.child(this.buildMergeContext(chatId, branchName, context, extra));
  }

  private sessionRuntimeContext(session: MergeSession, extra?: MergeRuntimeContext): MergeRuntimeContext {
    return {
      traceId: extra?.traceId ?? session.traceId,
      threadId: extra?.threadId ?? session.threadId,
      turnId: extra?.turnId ?? session.turnId,
      userId: extra?.userId ?? session.userId,
      resolverName: extra?.resolverName ?? session.resolverName
    };
  }

  private requireBaseBranch(chatId: string, branchName: string, runtimeConfig: { baseBranch?: string }, context?: MergeRuntimeContext): string {
    const baseBranch = runtimeConfig.baseBranch?.trim();
    if (!baseBranch) {
      this.mergeLogger(chatId, branchName, context).error("merge base branch is missing from project config");
      throw new Error("project has no defaultBranch configured");
    }
    return baseBranch;
  }

  private async assertMainRepoOnBaseBranch(
    chatId: string,
    branchName: string,
    mainCwd: string,
    baseBranch: string,
    context?: MergeRuntimeContext
  ): Promise<void> {
    const currentBranch = await getCurrentBranch(mainCwd);
    if (currentBranch !== baseBranch) {
      this.mergeLogger(chatId, branchName, context, { worktreePath: mainCwd }).error({ currentBranch, baseBranch }, "project cwd is not on configured base branch");
      throw new Error(`project cwd is on branch "${currentBranch}", expected "${baseBranch}"`);
    }
  }

  private async assertSessionReadyToCommit(session: MergeSession, context?: MergeRuntimeContext): Promise<void> {
    const pendingFiles = session.files.filter((file) => file.decision === "pending").map((file) => file.path);
    if (pendingFiles.length > 0) {
      throw new Error(`仍有未决文件，无法提交: ${pendingFiles.join(", ")}`);
    }

    const unresolvedByStatus = session.files.filter((file) => file.status === "conflict").map((file) => file.path);
    if (unresolvedByStatus.length > 0) {
      throw new Error(`仍有冲突文件未解决，无法提交: ${unresolvedByStatus.join(", ")}`);
    }

    const { resolved, remaining } = await checkConflictsResolved(
      session.worktreeCwd,
      this.buildMergeContext(session.chatId, session.branchName, context, { worktreePath: session.worktreeCwd })
    );
    if (!resolved) {
      throw new Error(`git index 仍存在未解决冲突: ${remaining.join(", ")}`);
    }
  }

  private async assertAgentRetryScopedToFile(session: MergeSession, filePath: string, context?: MergeRuntimeContext): Promise<void> {
    const before = session.agentRetryBaseline ?? {};
    const after = await readWorktreeStatusMap(
      session.worktreeCwd,
      this.buildMergeContext(session.chatId, session.branchName, context, { worktreePath: session.worktreeCwd, filePath })
    );
    const touched = new Set([...Object.keys(before), ...Object.keys(after)]);
    const unexpected = [...touched].filter((path) => path !== filePath && before[path] !== after[path]);
    if (unexpected.length > 0) {
      throw new Error(`Agent modified files outside target file: ${unexpected.join(", ")}`);
    }
  }

  async handleMergeDryRun(
    projectId: string, chatId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<DryRunMergeResult & { baseBranch: string }> {
    // Delegate to handleMergePreview for the actual dry-run logic
    const result = await this.handleMergePreview(chatId, branchName, context);

    if (result.canMerge) {
      const runtimeConfig = await this.ctx.runtimeConfigProvider.getProjectRuntimeConfig(this.ctx.resolveProjectId(chatId));
      const mainCwd = runtimeConfig.cwd ?? "";
      let preMergeSha: string | undefined;
      try {
        preMergeSha = await createSnapshot(mainCwd);
      } catch { /* snapshot failure is non-critical */ }

      this.pendingMerges.set(this.mergeKey(chatId, branchName), {
        projectId,
        branchName,
        diffStats: result.diffStats,
        preMergeSha
      });
    }

    return result;
  }

  async handleMergeConfirm(
    chatId: string, branchName: string, options?: { deleteBranch?: boolean }, context?: MergeRuntimeContext
  ): Promise<{ success: boolean; message: string }> {
    const key = this.mergeKey(chatId, branchName);
    const projectId = this.ctx.resolveProjectId(chatId);

    // Delegate to handleMerge — no longer relies on pendingMerges for the core merge logic.
    // handleMerge creates its own snapshot, performs the merge, and handles cleanup.
    const result = await this.handleMerge(projectId, chatId, branchName, options, context);
    this.pendingMerges.delete(key);
    return result;
  }

  handleMergeReject(chatId: string, branchName: string): void {
    this.pendingMerges.delete(this.mergeKey(chatId, branchName));
  }

  async onResolverTurnComplete(chatId: string, resolverName: string, context?: MergeRuntimeContext): Promise<void> {
    const branchName = resolverName.replace(/^merge-/, "");
    const mergeContext = { ...context, resolverName };
    const mergeLog = this.mergeLogger(chatId, branchName, mergeContext);
    mergeLog.info("onResolverTurnComplete: START");

    const runtimeConfig = await this.ctx.runtimeConfigProvider.getProjectRuntimeConfig(this.ctx.resolveProjectId(chatId));
    const mainCwd = runtimeConfig.cwd ?? "";
    const baseBranch = this.requireBaseBranch(chatId, branchName, runtimeConfig, mergeContext);
    if (!mainCwd) {
      mergeLog.error("onResolverTurnComplete: no cwd configured");
      return;
    }

    const worktreePath = getWorktreePath(mainCwd, resolverName);

    const gitContext = this.buildMergeContext(chatId, branchName, mergeContext, { worktreePath });
    const { resolved, remaining } = await checkConflictsResolved(worktreePath, gitContext);
    if (!resolved) {
      mergeLog.warn({ remaining, worktreePath }, "onResolverTurnComplete: unresolved conflicts remain");
      this.resolverCompleteHandler?.({
        chatId, branchName, baseBranch, resolverName,
        traceId: mergeContext.traceId,
        threadId: mergeContext.threadId,
        turnId: mergeContext.turnId,
        success: false,
        message: `Agent 未能完全解决冲突，仍有 ${remaining.length} 个文件未解决`,
        remaining
      });
      return;
    }

    try {
      const committed = await commitWorktreeChanges(worktreePath, `[codex] resolve merge conflicts: ${branchName}`, gitContext);
      if (committed) {
        mergeLog.info({ worktreePath }, "onResolverTurnComplete: auto-committed resolver changes");
      }
    } catch (err) {
      mergeLog.warn({ err: err instanceof Error ? err.message : err, worktreePath }, "onResolverTurnComplete: auto-commit failed");
    }

    let diffStats: MergeDiffStats | undefined;
    try {
      const dryRun = await dryRunMerge(mainCwd, resolverName, this.buildMergeContext(chatId, branchName, mergeContext, { worktreePath: mainCwd, mergeBranch: resolverName }));
      diffStats = dryRun.diffStats;
    } catch (err) {
      mergeLog.warn({ err: err instanceof Error ? err.message : err }, "onResolverTurnComplete: dryRunMerge failed");
    }

    const projectId = "default-project";
    let preMergeSha: string | undefined;
    try {
      preMergeSha = await createSnapshot(mainCwd);
    } catch { /* non-critical */ }

    this.pendingMerges.set(this.mergeKey(chatId, resolverName), {
      projectId,
      branchName,
      mergeBranch: resolverName,
      diffStats,
      preMergeSha
    });

    mergeLog.info({ hasStats: !!diffStats }, "onResolverTurnComplete: ready for merge approval");
    this.resolverCompleteHandler?.({
      chatId, branchName, baseBranch, resolverName,
      traceId: mergeContext.traceId,
      threadId: mergeContext.threadId,
      turnId: mergeContext.turnId,
      success: true,
      message: `Agent 已解决 ${branchName} 的所有冲突，等待确认合并`,
      diffStats
    });
  }

  async handleMergeWithConflictResolver(
    projectId: string, chatId: string, branchName: string, conflicts: string[], userId?: string, context?: MergeRuntimeContext
  ): Promise<{ threadName: string; threadId: string; conflicts: string[] }> {
    const resolverName = `merge-${branchName}`;
    const mergeContext = { ...context, userId: context?.userId ?? userId, resolverName };
    const mergeLog = this.mergeLogger(chatId, branchName, mergeContext);

    // Resolve backend info from current thread (if any) or use defaults
    const runtimeConfig = await this.ctx.runtimeConfigProvider.getProjectRuntimeConfig(this.ctx.resolveProjectId(chatId), userId);
    const mainCwd = runtimeConfig.cwd ?? "";
    this.requireBaseBranch(chatId, branchName, runtimeConfig, mergeContext);

    // Determine backend/model for the resolver thread
    const backendId = runtimeConfig.backend?.backendId ?? "codex";
    const model = runtimeConfig.backend?.model ?? "gpt-5-codex";

    // Get serverCmd from backend definition
    const resolvedBackendId = isBackendId(backendId) ? backendId : "codex" as const;

    // Create the resolver thread via unified createThread
    // Note: createThread handles worktree, pool, threadStart, registry, bindings
    const created = await this.ctx.createThread(
      projectId, chatId, userId ?? "system", resolverName,
      { backendId: resolvedBackendId, model, approvalPolicy: "on-request" }
    );

    // Start the conflict merge in the worktree
    const mergeResult = await startConflictMerge(created.cwd, branchName, this.buildMergeContext(chatId, branchName, mergeContext, { worktreePath: created.cwd }));

    // Send the conflict resolution prompt
    const conflictList = mergeResult.conflicts.length > 0 ? mergeResult.conflicts : conflicts;
    const prompt = [
      `You are resolving merge conflicts between branch "${branchName}" and main.`,
      `The following files have conflicts:`,
      ...conflictList.map(f => `- ${f}`),
      "",
      "Please resolve each conflict by editing the files to remove conflict markers (<<<<<<< ======= >>>>>>>).",
      "After resolving each file, run: git add <filename>",
      "When all conflicts are resolved, run: git commit --no-edit"
    ].join("\n");

    await created.api.turnStart({
      threadId: created.threadId,
      input: [{ type: "text", text: prompt }]
    });

    let preMergeSha: string | undefined;
    try {
      preMergeSha = await createSnapshot(mainCwd);
    } catch { /* non-critical */ }

    this.pendingMerges.set(this.mergeKey(chatId, branchName), {
      projectId,
      branchName,
      preMergeSha
    });

    mergeLog.info({ worktreePath: created.cwd, conflictCount: conflictList.length }, "handleMergeWithConflictResolver: resolver thread started");

    return {
      threadName: resolverName,
      threadId: created.threadId,
      conflicts: conflictList
    };
  }

  async handleMergePreview(
    chatId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<DryRunMergeResult & { baseBranch: string }> {
    const mergeLog = this.mergeLogger(chatId, branchName, context);
    const runtimeConfig = await this.ctx.runtimeConfigProvider.getProjectRuntimeConfig(this.ctx.resolveProjectId(chatId));
    const mainCwd = runtimeConfig.cwd ?? "";
    const baseBranch = this.requireBaseBranch(chatId, branchName, runtimeConfig, context);
    if (!mainCwd) throw new Error("project has no cwd configured");
    await this.assertMainRepoOnBaseBranch(chatId, branchName, mainCwd, baseBranch, context);

    const worktreePath = getWorktreePath(mainCwd, branchName);

    mergeLog.info({ mainCwd, worktreePath }, "handleMergePreview: START");

    // Guard: worktree must be clean (committed by finishTurn)
    if (await isWorktreeDirty(worktreePath)) {
      throw new OrchestratorError(ErrorCode.WORKTREE_DIRTY, "worktree has uncommitted changes — 请先 accept 或 revert 当前修改");
    }

    const result = await dryRunMerge(mainCwd, branchName, this.buildMergeContext(chatId, branchName, context, { worktreePath }));
    mergeLog.info({
      canMerge: result.canMerge,
      hasStats: !!result.diffStats,
      additions: result.diffStats?.additions,
      deletions: result.diffStats?.deletions,
      fileCount: result.diffStats?.filesChanged.length
    }, "handleMergePreview: RESULT");
    return { ...result, baseBranch };
  }

  async handleMerge(
    projectId: string, chatId: string, branchName: string, options?: { force?: boolean; deleteBranch?: boolean }, context?: MergeRuntimeContext
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    const mergeLog = this.mergeLogger(chatId, branchName, context);
    const runtimeConfig = await this.ctx.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd ?? "";
    const baseBranch = this.requireBaseBranch(chatId, branchName, runtimeConfig, context);
    if (!mainCwd) throw new Error("project has no cwd configured");
    await this.assertMainRepoOnBaseBranch(chatId, branchName, mainCwd, baseBranch, context);

    // Guard: worktree must be clean (committed by finishTurn)
    const worktreePath = getWorktreePath(mainCwd, branchName);
    if (await isWorktreeDirty(worktreePath)) {
      throw new OrchestratorError(ErrorCode.WORKTREE_DIRTY, "worktree has uncommitted changes — 请先 accept 或 revert 当前修改");
    }

    let preMergeSha: string | undefined;
    try {
      preMergeSha = await createSnapshot(mainCwd);
    } catch { /* snapshot failure should not block merge */ }

    const result = await mergeWorktree(mainCwd, branchName, options?.force, this.buildMergeContext(chatId, branchName, context, { worktreePath }));
    mergeLog.info({ success: result.success, hasConflicts: !!result.conflicts?.length }, "handleMerge: mergeWorktree completed");

    if (result.success && preMergeSha && this.ctx.snapshotRepo) {
      try {
        const mainThreadId = MAIN_THREAD_NAME;
        const turnId = `merge-${branchName}-${Date.now()}`;
        await pinSnapshot(mainCwd, preMergeSha, `codex-merge-${branchName}`);
        const turnIndex = (await this.ctx.snapshotRepo.getLatestIndex(projectId, mainThreadId)) + 1;
        await this.ctx.snapshotRepo.save({
          projectId, chatId, threadId: mainThreadId, turnId, turnIndex,
          cwd: mainCwd, gitRef: preMergeSha,
          agentSummary: `合并分支: ${branchName}`,
          createdAt: new Date().toISOString()
        });
      } catch { /* snapshot persistence failure should not block merge */ }
    }

    if (result.success) {
      this.ctx.markThreadMerged(projectId, branchName);
    }

    return result;
  }

  /* ── Per-file merge review methods ──────────────────────────────────── */

  private projectThreadMergeKey(chatId: string, branchName: string): string {
    return `${chatId}:session:${branchName}`;
  }

  /** Check if the project-bound chat has ANY active merge session (concurrency guard). */
  private hasChatMergeSession(chatId: string): string | null {
    for (const [key, session] of this.mergeSessions) {
      if (session.chatId === chatId) return session.branchName;
    }
    return null;
  }

  /** Schedule auto-abort for a session after timeout. */
  private scheduleSessionTimeout(mergeSessionKey: string, session: MergeSession): void {
    session.timeoutTimer = setTimeout(async () => {
      const s = this.mergeSessions.get(mergeSessionKey);
      if (!s) return;
      const runtimeContext = this.sessionRuntimeContext(s);
      const mergeLog = this.mergeLogger(s.chatId, s.branchName, runtimeContext, { worktreePath: s.worktreeCwd });
      mergeLog.warn("merge session timed out, auto-aborting");
      try {
        await gitAbortMergeSession(s.worktreeCwd, this.buildMergeContext(s.chatId, s.branchName, runtimeContext, { worktreePath: s.worktreeCwd }));
      } catch { /* best-effort */ }
      this.mergeSessions.delete(mergeSessionKey);
      // Path B convergence: route timeout through AgentEventRouter
      this.ctx.routeMessage(s.chatId, { kind: "merge_timeout", chatId: s.chatId, branchName: s.branchName }).catch(() => {});
    }, MergeUseCase.SESSION_TIMEOUT_MS);
  }

  /** Clear timeout timer for a session. */
  private clearSessionTimeout(mergeSessionKey: string): void {
    const session = this.mergeSessions.get(mergeSessionKey);
    if (session?.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = undefined;
    }
  }

  getMergeSession(chatId: string, branchName: string): MergeSession | undefined {
    return this.mergeSessions.get(this.projectThreadMergeKey(chatId, branchName));
  }

  /**
   * Start a per-file merge review (PR-style).
   * Merges main into the branch worktree.
   * If conflicts exist → store session as 'resolving', return conflict list.
   * If no conflicts → store session as 'reviewing', return first file review.
   */
  async startMergeReview(
    chatId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview> {
    const mergeLog = this.mergeLogger(chatId, branchName, context);
    const projectId = this.ctx.resolveProjectId(chatId);
    const runtimeConfig = await this.ctx.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd ?? "";
    const baseBranch = this.requireBaseBranch(chatId, branchName, runtimeConfig, context);
    if (!mainCwd) throw new Error("project has no cwd configured");
    await this.assertMainRepoOnBaseBranch(chatId, branchName, mainCwd, baseBranch, context);

    // Guard: worktree must be clean
    const worktreeCwd = getWorktreePath(mainCwd, branchName);
    if (await isWorktreeDirty(worktreeCwd)) {
      throw new OrchestratorError(ErrorCode.WORKTREE_DIRTY, "worktree has uncommitted changes — 请先 accept 或 revert 当前修改");
    }

    // Guard: no existing session for this project-thread merge branch in the bound chat
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    if (this.mergeSessions.has(mergeSessionKey)) {
      throw new OrchestratorError(ErrorCode.MERGE_IN_PROGRESS, "该分支已有正在进行的合并审阅");
    }

    // Guard: no concurrent merge for this chat (different branch)
    const activeBranch = this.hasChatMergeSession(chatId);
    if (activeBranch) {
      throw new OrchestratorError(ErrorCode.MERGE_IN_PROGRESS, `已有分支 ${activeBranch} 正在合并审阅中，请先完成或取消`);
    }

    // PR-style: merge main into the branch worktree
    const { files, preMergeSha } = await gitStartMergeSession(worktreeCwd, baseBranch, this.buildMergeContext(chatId, branchName, context, { worktreePath: worktreeCwd }));

    if (files.length === 0) {
      await gitAbortMergeSession(worktreeCwd, this.buildMergeContext(chatId, branchName, context, { worktreePath: worktreeCwd }));
      throw new OrchestratorError(ErrorCode.MERGE_NO_CHANGES, "分支没有需要合并的变更");
    }

    const conflictFiles = files.filter(f => f.status === "conflict");

    const session: MergeSession = {
      projectId,
      chatId,
      branchName,
      baseBranch,
      mainCwd,
      worktreeCwd,
      preMergeSha,
      files: files.map(f => ({
        ...f,
        decision: "pending" as const,
        agentAttempts: 0
      })),
      currentIndex: 0,
      state: "reviewing",
      createdAt: Date.now(),
      traceId: context?.traceId,
      threadId: context?.threadId,
      turnId: context?.turnId,
      userId: context?.userId,
      resolverName: context?.resolverName
    };

    session.currentIndex = firstPendingIndex(session);

    this.mergeSessions.set(mergeSessionKey, session);
    this.scheduleSessionTimeout(mergeSessionKey, session);

    mergeLog.info({ totalFiles: files.length, conflicts: conflictFiles.length, worktreePath: worktreeCwd }, "startMergeReview: entering review");
    return buildFileReview(session);
  }

  /**
   * Legacy batch conflict resolution entry.
   * The current flow is manual-first and uses per-file agent retry from reviewing state.
   */
  async resolveConflictsViaAgent(chatId: string, branchName: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    const runtimeContext = session ? this.sessionRuntimeContext(session, context) : context;
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, session ? { worktreePath: session.worktreeCwd } : undefined);
    if (!session) {
      mergeLog.error("resolveConflictsViaAgent: no active merge session");
      throw new Error("没有正在进行的合并审阅");
    }
    if (session.state !== "resolving") {
      mergeLog.error({ state: session.state }, "resolveConflictsViaAgent: invalid session state");
      throw new Error("当前合并流程不支持批量 Agent 接管；请在逐文件审阅中对单个文件发起 Agent 重试");
    }

    const conflictFiles = session.files.filter(f => f.status === "conflict");

    try {
      const api = await this.ctx.resolveAgentApi(chatId, branchName);

      const prompt = [
        `你正在解决 main 分支合并到分支 "${branchName}" 时产生的冲突。`,
        `工作目录: ${session.worktreeCwd}`,
        ``,
        `以下文件存在冲突，请逐一编辑并移除冲突标记 (<<<<<<< ======= >>>>>>>):`,
        ...conflictFiles.map(f => `- ${f.path}`),
        ``,
        `完成每个文件后，运行: git add <filename>`,
        `请确保合并结果保留双方的有效修改，使代码功能完整且可编译。`,
      ].join("\n");

      // Get thread record for threadId
      const threadRecord = this.ctx.getThreadRecord(session.projectId, branchName);
      const threadId = threadRecord?.threadId ?? branchName;
      const started = await api.turnStart({
        threadId,
        input: [{ type: "text", text: prompt }]
      });
      const turnId = started.turn.id;

      // Bind pipeline so turn_complete routes to onMergeConflictResolved
      this.ctx.bindTurnPipeline?.({
        chatId, threadName: branchName, threadId, turnId,
        userId: runtimeContext?.userId,
        traceId: runtimeContext?.traceId,
        cwd: session.worktreeCwd,
        isMergeConflictResolver: true,
      });

      session.turnId = turnId;
      session.threadId = threadId;
      session.traceId = runtimeContext?.traceId ?? session.traceId;
      session.userId = runtimeContext?.userId ?? session.userId;
      mergeLog.info({ conflicts: conflictFiles.length, turnId, threadId }, "resolveConflictsViaAgent: Agent turn started");
    } catch (err) {
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "resolveConflictsViaAgent: failed to start Agent turn");
      // Fallback: transition to reviewing with unresolved conflicts
      session.state = "reviewing";
      // Path B convergence: route review through AgentEventRouter
      await this.ctx.routeMessage(chatId, { kind: "merge_review", review: buildFileReview(session) });
    }
  }

  /**
   * Phase 2: Called when the Agent's conflict resolution turn completes.
   * Re-reads file diffs, updates statuses, transitions to reviewing.
   */
  async onMergeResolverDone(chatId: string, branchName: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    const runtimeContext = session ? this.sessionRuntimeContext(session, context) : context;
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, session ? { worktreePath: session.worktreeCwd } : undefined);
    if (!session) {
      mergeLog.warn("onMergeResolverDone: no session");
      return;
    }

    const { resolved, remaining } = await checkConflictsResolved(
      session.worktreeCwd,
      this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd })
    );
    const remainingSet = new Set(remaining);

    // Re-check each conflict file
    for (const file of session.files) {
      if (file.status === "conflict") {
        if (!remainingSet.has(file.path)) {
          file.status = "agent_resolved";
          file.agentAttempts++;
          file.diff = await this.readFileDiff(chatId, session.worktreeCwd, branchName, file.path, runtimeContext);
        }
      }
    }

    session.state = "reviewing";
    session.currentIndex = firstPendingIndex(session);
    mergeLog.info({ resolved, remaining }, "onMergeResolverDone: transitioned to reviewing");

    // Path B convergence: route review through AgentEventRouter
    await this.ctx.routeMessage(chatId, { kind: "merge_review", review: buildFileReview(session) });
  }

  /**
   * Phase 2: Reject an agent-resolved file with feedback, trigger Agent retry.
   */
  async retryFileWithAgent(
    chatId: string, branchName: string, filePath: string, feedback: string, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath });

    const file = session.files.find(f => f.path === filePath);
    if (!file) throw new Error(`文件不在合并列表中: ${filePath}`);

    file.lastFeedback = feedback;
    file.status = "agent_pending";
    const currentIndex = session.files.indexOf(file);
    if (currentIndex >= 0) session.currentIndex = currentIndex;
    session.activeAgentFilePath = filePath;
    session.agentRetryBaseline = await readWorktreeStatusMap(
      session.worktreeCwd,
      this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath })
    );
    const pendingReview = buildFileReview(session);

    try {
      const api = await this.ctx.resolveAgentApi(chatId, branchName);

      const prompt = await buildSingleFileMergeAgentPrompt({
        worktreeCwd: session.worktreeCwd,
        filePath,
        userPrompt: feedback,
      });

      const threadRecord = this.ctx.getThreadRecord(session.projectId, branchName);
      const threadId = threadRecord?.threadId ?? branchName;
      const started = await api.turnStart({
        threadId,
        input: [{ type: "text", text: prompt }]
      });
      const turnId = started.turn.id;

      // Bind pipeline so turn_complete routes to onMergeFileRetryDone
      this.ctx.bindTurnPipeline?.({
        chatId, threadName: branchName, threadId, turnId,
        userId: runtimeContext?.userId,
        traceId: runtimeContext?.traceId,
        cwd: session.worktreeCwd,
        isMergeConflictResolver: true,
        mergeRetryFilePath: filePath,
      });

      session.turnId = turnId;
      session.threadId = threadId;
      session.traceId = runtimeContext.traceId ?? session.traceId;
      session.userId = runtimeContext.userId ?? session.userId;
      mergeLog.info({ attempt: file.agentAttempts + 1, turnId, threadId }, "retryFileWithAgent: Agent turn started");
      return pendingReview;
    } catch (err) {
      file.status = "conflict";
      session.activeAgentFilePath = undefined;
      session.agentRetryBaseline = undefined;
      await this.ctx.routeMessage(chatId, { kind: "merge_review", review: buildFileReview(session) });
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "retryFileWithAgent: Agent turn failed");
      throw new Error("Agent 重试失败，请手动选择 keep_main 或 use_branch");
    }
  }

  /**
   * Phase 2: Called when Agent finishes retrying a specific file.
   */
  async onMergeFileRetryDone(chatId: string, branchName: string, filePath: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    if (!session) return;
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath });

    const file = session.files.find(f => f.path === filePath);
    if (!file) return;
    try {
      await this.assertAgentRetryScopedToFile(session, filePath, runtimeContext);
      file.agentAttempts++;
      file.diff = await this.readFileDiff(chatId, session.worktreeCwd, branchName, file.path, runtimeContext);
      file.decision = "pending";
      const { remaining } = await checkConflictsResolved(
        session.worktreeCwd,
        this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath })
      );
      file.status = remaining.includes(file.path) ? "conflict" : "agent_resolved";

      // Set current index to this file
      const idx = session.files.indexOf(file);
      if (idx >= 0) session.currentIndex = idx;
      mergeLog.info({ attempt: file.agentAttempts }, "onMergeFileRetryDone: file re-read");
    } catch (err) {
      file.status = "conflict";
      file.decision = "pending";
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "onMergeFileRetryDone: validation failed");
      await this.ctx.routeMessage(chatId, {
        kind: "notification",
        threadId: session.threadId ?? "",
        category: "warning",
        title: "Agent 合并结果未通过校验",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      session.activeAgentFilePath = undefined;
      session.agentRetryBaseline = undefined;
    }

    await this.ctx.routeMessage(chatId, { kind: "merge_review", review: buildFileReview(session) });
  }

  /* ── Git helpers for Phase 2 ──────────────────────────────────────── */

  private async readFileDiff(chatId: string, cwd: string, branchName: string, filePath: string, context?: MergeRuntimeContext): Promise<string> {
    return readCachedFileDiff(cwd, filePath, this.buildMergeContext(chatId, branchName, context, { filePath, worktreePath: cwd }));
  }

  /**
   * Record a user decision for a file, apply it to git, and advance.
   * Returns the next file review, or a summary if all files are done.
   */
  async decideFile(
    chatId: string, branchName: string, filePath: string, decision: MergeFileDecision, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview | IMMergeSummary> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath });

    // Find and update the file
    const file = session.files.find(f => f.path === filePath);
    if (!file) throw new Error(`文件不在合并列表中: ${filePath}`);
    if (file.decision !== "pending") return buildFileReview(session); // guard: already decided
    file.decision = decision;

    // Apply the git-level decision (PR-style: worktreeCwd)
      await gitApplyFileDecision(session.worktreeCwd, filePath, decision, session.baseBranch, this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath }));
    mergeLog.info({ decision }, "decideFile: decision applied");

    // Find next pending file
    const nextIdx = firstPendingIndex(session);
    if (nextIdx === -1) {
      // All files decided → return summary
      return buildMergeSummary(session);
    }

    session.currentIndex = nextIdx;
    return buildFileReview(session);
  }

  /**
   * Accept all remaining pending files at once.
   */
  async acceptAllRemaining(
    chatId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<IMMergeSummary | IMFileMergeReview> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });

    for (const file of session.files) {
      if (file.decision === "pending") {
        if (file.status === "conflict") continue; // cannot batch-accept unresolved conflicts
        file.decision = "accept";
        await gitApplyFileDecision(session.worktreeCwd, file.path, "accept", session.baseBranch, this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath: file.path }));
      }
    }

    mergeLog.info("acceptAllRemaining: applied to all pending files");
    const nextIdx = firstPendingIndex(session);
    if (nextIdx >= 0) {
      session.currentIndex = nextIdx;
      return buildFileReview(session);
    }
    return buildMergeSummary(session);
  }

  /**
   * Commit the merge session after all decisions are made.
   */
  async commitMergeReview(
    chatId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<{ success: boolean; message: string }> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });
    await this.assertSessionReadyToCommit(session, runtimeContext);

    // Stage 3: Commit merge in worktree
    const result = await gitCommitMergeSession(session.worktreeCwd, branchName, session.baseBranch, undefined, this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd }));

    // Log decision summary for audit
    const decisionSummary = session.files.reduce((acc, f) => {
      const d = f.decision === "pending" ? "skip" : f.decision;
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    mergeLog.info({ decisions: decisionSummary, success: result.success }, "commitMergeReview: worktree committed");

    if (result.success) {
      // Stage 4: Fast-forward main to the branch
      const ffResult = await gitFastForwardMain(session.mainCwd, branchName, session.baseBranch, this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.mainCwd }));
      if (!ffResult.success) {
        mergeLog.error({ message: ffResult.message }, "commitMergeReview: fast-forward main failed");
        return ffResult;
      }
      mergeLog.info({ mainCwd: session.mainCwd }, "commitMergeReview: main fast-forwarded");

      // Record snapshot
      if (session.preMergeSha && this.ctx.snapshotRepo) {
        try {
          const mainThreadId = MAIN_THREAD_NAME;
          const turnId = `merge-${branchName}-${Date.now()}`;
          await pinSnapshot(session.mainCwd, session.preMergeSha, `codex-merge-${branchName}`);
          const turnIndex = (await this.ctx.snapshotRepo.getLatestIndex(session.projectId, mainThreadId)) + 1;
          await this.ctx.snapshotRepo.save({
            projectId: session.projectId, chatId, threadId: mainThreadId, turnId, turnIndex,
            cwd: session.mainCwd, gitRef: session.preMergeSha,
            agentSummary: `合并分支: ${branchName} (per-file review)`,
            createdAt: new Date().toISOString()
          });
        } catch { /* non-critical */ }
      }

      await removeWorktree(session.mainCwd, session.worktreeCwd, branchName);
      this.ctx.markThreadMerged(session.projectId, branchName);
    }

    this.clearSessionTimeout(mergeSessionKey);
    this.mergeSessions.delete(mergeSessionKey);
    return result;
  }

  /**
   * Cancel the merge review, aborting the git merge.
   */
  async cancelMergeReview(chatId: string, branchName: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(chatId, branchName);
    const session = this.mergeSessions.get(mergeSessionKey);
    if (!session) return;

    const runtimeContext = this.sessionRuntimeContext(session, context);
    await gitAbortMergeSession(session.worktreeCwd, this.buildMergeContext(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd }));
    this.clearSessionTimeout(mergeSessionKey);
    this.mergeSessions.delete(mergeSessionKey);
    this.mergeLogger(chatId, branchName, runtimeContext, { worktreePath: session.worktreeCwd }).info("cancelMergeReview: session cancelled");
  }
}
