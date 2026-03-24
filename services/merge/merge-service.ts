import { MAIN_THREAD_NAME } from "../thread/constants";
import { parseMergeResolverName } from "./merge-naming";
import { createBackendIdentity, isBackendId } from "../../packages/agent-core/src/index";
import type { AgentApi, RuntimeConfig } from "../../packages/agent-core/src/index";
import { createLogger } from "../../packages/logger/src/index";
import type { MergeFileStatus, MergeFileDecision, IMFileMergeReview, IMMergeSummary } from "../event/im-output";
import type { GitOps } from "../../packages/git-utils/src/index";
import { ALL_BACKEND_SKILL_DIRS } from "../plugin/plugin-paths";
import type { MergeDiffStats, DryRunMergeResult } from "../../packages/git-utils/src/index";
import type { MergeLogContext } from "../../packages/git-utils/src/index";
import { OrchestratorError, ErrorCode } from "../errors";
import type { MergeTurnPipeline, PendingMerge } from "./merge-types";
import type { RuntimeConfigProvider } from "../../packages/agent-core/src/index";
import type { ThreadRuntimeService } from "../thread/thread-runtime-service";
import type { ThreadRecord } from "../thread/types";
import type { SnapshotRepository } from "../snapshot/snapshot-repository";
import type { MergeSessionRepository } from "./merge-session-repository";
import type { IMOutputMessage } from "../event/im-output";
import type { MergeRuntimeContext, MergeSession } from "./merge-session-model";
import { fromPersistedMergeSessionRecord, toPersistedMergeSessionRecord } from "./merge-session-codec";
import { availableDecisionsForStatus, buildFileReview, buildMergeSummary, firstPendingIndex } from "./merge-review-model";
import type { ProjectResolver } from "../project/project-resolver";

export interface MergeServiceDeps {
  runtimeConfigProvider: RuntimeConfigProvider;
  projectResolver: ProjectResolver;
  threadRuntimeService: ThreadRuntimeService;
  threadService: {
    getRecord(projectId: string, threadName: string): Promise<ThreadRecord | null>;
    listRecords(projectId: string): Promise<ThreadRecord[]>;
    getRuntimeState(projectId: string, threadName: string): Promise<{ activeTurnId?: string; blockingTurnId?: string } | null>;
    register(record: ThreadRecord): Promise<void>;
    updateRecordRuntime(projectId: string, threadName: string, patch: Partial<Pick<ThreadRecord, "baseSha" | "hasDiverged" | "worktreePath">>): Promise<void>;
    markMerged(projectId: string, threadName: string): Promise<void>;
  };
  snapshotRepo?: SnapshotRepository;
  mergeSessionRepository?: MergeSessionRepository;
  turnPipeline: MergeTurnPipeline;
  interruptThread: (projectId: string, threadName: string, options?: { threadId?: string; turnId?: string }) => Promise<{ interrupted: boolean }>;
  gitOps: GitOps;
}
import type { PersistedMergeSessionRecord } from "./merge-session-repository";
import { buildSingleFileMergeAgentPrompt, buildBatchFileMergeAgentPrompt } from "./merge-agent-prompt";


const log = createLogger("merge");

export class MergeUseCase {
  private readonly pendingMerges = new Map<string, PendingMerge>();
  private readonly mergeSessions = new Map<string, MergeSession>();
  private static readonly SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

  constructor(private readonly deps: MergeServiceDeps) {}

  private mergeKey(projectId: string, branchName: string): string {
    return `${projectId}:merge:${branchName}`;
  }

  private async requireProjectChatId(projectId: string): Promise<string> {
    const chatId = (await this.deps.projectResolver.findProjectById?.(projectId))?.chatId?.trim();
    if (!chatId) {
      throw new Error(`merge session requires bound project chatId: projectId=${projectId}`);
    }
    return chatId;
  }

  private buildMergeContext(
    projectId: string,
    branchName: string,
    context?: MergeRuntimeContext,
    extra?: MergeLogContext
  ): MergeLogContext {
    const base: MergeLogContext = {
      projectId,
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

  private mergeLogger(projectId: string, branchName: string, context?: MergeRuntimeContext, extra?: MergeLogContext) {
    return log.child(this.buildMergeContext(projectId, branchName, context, extra));
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

  private requireBaseBranch(projectId: string, branchName: string, runtimeConfig: { baseBranch?: string }, context?: MergeRuntimeContext): string {
    const baseBranch = runtimeConfig.baseBranch?.trim();
    if (!baseBranch) {
      this.mergeLogger(projectId, branchName, context).error("merge base branch is missing from project config");
      throw new Error("project has no defaultBranch configured");
    }
    return baseBranch;
  }

  private async assertMainRepoOnBaseBranch(
    projectId: string,
    branchName: string,
    mainCwd: string,
    baseBranch: string,
    context?: MergeRuntimeContext
  ): Promise<void> {
    const currentBranch = await this.deps.gitOps.repo.getCurrentBranch(mainCwd);
    if (currentBranch !== baseBranch) {
      this.mergeLogger(projectId, branchName, context, { worktreePath: mainCwd }).error({ currentBranch, baseBranch }, "project cwd is not on configured base branch");
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

    const { resolved, remaining } = await this.deps.gitOps.merge.checkResolved(
      session.worktreeCwd,
      this.buildMergeContext(session.projectId, session.branchName, context, { worktreePath: session.worktreeCwd })
    );
    if (!resolved) {
      throw new Error(`git index 仍存在未解决冲突: ${remaining.join(", ")}`);
    }
  }

  private async hasPersistedMergeSession(projectId: string, branchName: string): Promise<boolean> {
    return (await this.deps.mergeSessionRepository?.get(projectId, branchName)) != null;
  }

  private hasInMemoryMergeSession(projectId: string, branchName: string): boolean {
    return this.mergeSessions.has(this.projectThreadMergeKey(projectId, branchName));
  }

  private isResolverThreadName(threadName: string): boolean {
    return parseMergeResolverName(threadName) !== null;
  }

  private async hasActiveOrBlockingTurn(projectId: string, threadName: string): Promise<boolean> {
    const state = await this.deps.threadService.getRuntimeState(projectId, threadName);
    return Boolean(state?.activeTurnId || state?.blockingTurnId);
  }

  private async syncThreadToHead(params: {
    projectId: string;
    threadName: string;
    targetHead: string;
    expectedHead?: string;
    context?: MergeRuntimeContext;
  }): Promise<{ updated: boolean; newHead?: string; reason?: string }> {
    const { projectId, threadName, targetHead, expectedHead, context } = params;
    const runtimeConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd;
    if (!mainCwd) {
      throw new Error(`thread sync runtime config missing cwd: projectId=${projectId} thread=${threadName}`);
    }
    const worktreePath = this.deps.gitOps.worktree.getPath(mainCwd, threadName);
    await this.deps.gitOps.worktree.assertValid(mainCwd, worktreePath);
    if (await this.deps.gitOps.commit.isDirty(worktreePath)) {
      return { updated: false, reason: "worktree_dirty" };
    }
    if (expectedHead) {
      const result = await this.deps.gitOps.worktree.fastForwardIfHeadMatches(worktreePath, expectedHead, targetHead);
      if (!result.updated) {
        return { updated: false, newHead: result.newHead, reason: result.reason ?? "head_mismatch" };
      }
      await this.deps.threadService.updateRecordRuntime(projectId, threadName, {
        baseSha: result.newHead,
        hasDiverged: false,
        worktreePath,
      });
      return { updated: true, newHead: result.newHead };
    }
    const newHead = await this.deps.gitOps.worktree.fastForward(worktreePath, targetHead);
    await this.deps.threadService.updateRecordRuntime(projectId, threadName, {
      baseSha: newHead,
      hasDiverged: false,
      worktreePath,
    });
    return { updated: true, newHead };
  }

  private async syncMergedAndFollowerThreads(params: {
    projectId: string;
    branchName: string;
    oldMainHead: string;
    newMainHead: string;
    context?: MergeRuntimeContext;
  }): Promise<{
    mergedThreadUpdated: boolean;
    mergedThreadFailure?: string;
    followersUpdated: string[];
    followersSkipped: Array<{ threadName: string; reason: string }>;
    followersFailed: Array<{ threadName: string; reason: string }>;
  }> {
    const { projectId, branchName, oldMainHead, newMainHead, context } = params;
    const empty = {
      mergedThreadUpdated: false,
      mergedThreadFailure: undefined as string | undefined,
      followersUpdated: [] as string[],
      followersSkipped: [] as Array<{ threadName: string; reason: string }>,
      followersFailed: [] as Array<{ threadName: string; reason: string }>,
    };
    if (oldMainHead === newMainHead) {
      return empty;
    }

    const mergeLog = this.mergeLogger(projectId, branchName, context);
    const runtimeConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd;
    if (!mainCwd) {
      throw new Error(`thread sync runtime config missing cwd: projectId=${projectId}`);
    }

    let mergedThreadUpdated = false;
    let mergedThreadFailure: string | undefined;

    const mergedThreadState = await this.deps.threadService.getRuntimeState(projectId, branchName);
    if (mergedThreadState?.activeTurnId || mergedThreadState?.blockingTurnId) {
      mergedThreadFailure = `active_or_blocking_turn:${branchName}`;
    } else if (this.hasInMemoryMergeSession(projectId, branchName) || await this.hasPersistedMergeSession(projectId, branchName)) {
      mergedThreadFailure = `active_merge_session:${branchName}`;
    } else {
      try {
        const mergedResult = await this.syncThreadToHead({
          projectId,
          threadName: branchName,
          targetHead: newMainHead,
          context,
        });
        if (mergedResult.updated) {
          mergedThreadUpdated = true;
        } else {
          mergedThreadFailure = mergedResult.reason ?? `sync_not_updated:${branchName}`;
        }
      } catch (error) {
        mergedThreadFailure = error instanceof Error ? error.message : String(error);
      }
    }

    const followersUpdated: string[] = [];
    const followersSkipped: Array<{ threadName: string; reason: string }> = [];
    const followersFailed: Array<{ threadName: string; reason: string }> = [];

    for (const record of await this.deps.threadService.listRecords(projectId)) {
      const threadName = record.threadName;
      if (threadName === MAIN_THREAD_NAME || threadName === branchName || this.isResolverThreadName(threadName)) {
        continue;
      }
      if (await this.hasActiveOrBlockingTurn(projectId, threadName)) {
        followersSkipped.push({ threadName, reason: "active_or_blocking_turn" });
        continue;
      }
      if (this.hasInMemoryMergeSession(projectId, threadName) || await this.hasPersistedMergeSession(projectId, threadName)) {
        followersSkipped.push({ threadName, reason: "active_merge_session" });
        continue;
      }
      try {
        const worktreePath = this.deps.gitOps.worktree.getPath(mainCwd, threadName);
        await this.deps.gitOps.worktree.assertValid(mainCwd, worktreePath);
        const threadHead = await this.deps.gitOps.worktree.getHeadSha(worktreePath);
        if (threadHead !== oldMainHead) {
          followersSkipped.push({ threadName, reason: `not_following_old_main:${threadHead}` });
          continue;
        }
        const syncResult = await this.syncThreadToHead({
          projectId,
          threadName,
          targetHead: newMainHead,
          expectedHead: oldMainHead,
          context,
        });
        if (syncResult.updated) {
          followersUpdated.push(threadName);
        } else {
          followersSkipped.push({ threadName, reason: syncResult.reason ?? "not_updated" });
        }
      } catch (error) {
        followersFailed.push({
          threadName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    mergeLog.info({
      mergedThread: branchName,
      mergedThreadUpdated,
      mergedThreadFailure,
      newMainHead,
      followersUpdated,
      followersSkipped,
      followersFailed,
    }, "syncMergedAndFollowerThreads: completed");

    return {
      mergedThreadUpdated,
      mergedThreadFailure,
      followersUpdated,
      followersSkipped,
      followersFailed,
    };
  }

  private async assertAgentRetryScopedToFile(session: MergeSession, filePath: string, context?: MergeRuntimeContext): Promise<void> {
    const before = session.agentRetryBaseline ?? {};
    const after = await this.deps.gitOps.merge.readStatusMap(
      session.worktreeCwd,
      this.buildMergeContext(session.projectId, session.branchName, context, { worktreePath: session.worktreeCwd, filePath })
    );
    const touched = new Set([...Object.keys(before), ...Object.keys(after)]);
    const unexpected = [...touched].filter((path) => path !== filePath && before[path] !== after[path]);
    if (unexpected.length > 0) {
      throw new Error(`Agent modified files outside target file: ${unexpected.join(", ")}`);
    }
  }

  async handleMergeDryRun(
    projectId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<DryRunMergeResult & { baseBranch: string }> {
    // Delegate to handleMergePreview for the actual dry-run logic
    const result = await this.handleMergePreview(projectId, branchName, context);

    if (result.canMerge) {
      const runtimeConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
      const mainCwd = runtimeConfig.cwd;
      if (!mainCwd) {
        throw new Error(`merge dry-run runtime config missing cwd: projectId=${projectId} branch=${branchName}`);
      }
      const preMergeSha = await this.deps.gitOps.snapshot.create(mainCwd);

      this.pendingMerges.set(this.mergeKey(projectId, branchName), {
        projectId,
        branchName,
        diffStats: result.diffStats,
        preMergeSha
      });
    }

    return result;
  }

  async handleMergeConfirm(
    projectId: string, branchName: string, options?: { deleteBranch?: boolean }, context?: MergeRuntimeContext
  ): Promise<{ success: boolean; message: string }> {
    const key = this.mergeKey(projectId, branchName);

    // Delegate to handleMerge — no longer relies on pendingMerges for the core merge logic.
    // handleMerge creates its own snapshot, performs the merge, and handles cleanup.
    const result = await this.handleMerge(projectId, branchName, options, context);
    this.pendingMerges.delete(key);
    return result;
  }

  handleMergeReject(projectId: string, branchName: string): void {
    this.pendingMerges.delete(this.mergeKey(projectId, branchName));
  }

  async handleMergePreview(
    projectId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<DryRunMergeResult & { baseBranch: string }> {
    const mergeLog = this.mergeLogger(projectId, branchName, context);
    const runtimeConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd;
    const baseBranch = this.requireBaseBranch(projectId, branchName, runtimeConfig, context);
    if (!mainCwd) throw new Error("project has no cwd configured");
    await this.assertMainRepoOnBaseBranch(projectId, branchName, mainCwd, baseBranch, context);

    const worktreePath = this.deps.gitOps.worktree.getPath(mainCwd, branchName);

    mergeLog.info({ mainCwd, worktreePath }, "handleMergePreview: START");

    // Guard: worktree must exist on disk and be registered in git
    await this.deps.gitOps.worktree.assertValid(mainCwd, worktreePath);

    // Guard: worktree must be clean (committed by finishTurn)
    if (await this.deps.gitOps.commit.isDirty(worktreePath)) {
      throw new OrchestratorError(ErrorCode.WORKTREE_DIRTY, "worktree has uncommitted changes — 请先 accept 或 revert 当前修改");
    }

    const result = await this.deps.gitOps.merge.dryRun(mainCwd, branchName, this.buildMergeContext(projectId, branchName, context, { worktreePath }));
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
    projectId: string, branchName: string, options?: { force?: boolean; deleteBranch?: boolean }, context?: MergeRuntimeContext
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    const mergeLog = this.mergeLogger(projectId, branchName, context);
    const runtimeConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd;
    const baseBranch = this.requireBaseBranch(projectId, branchName, runtimeConfig, context);
    if (!mainCwd) throw new Error("project has no cwd configured");
    await this.assertMainRepoOnBaseBranch(projectId, branchName, mainCwd, baseBranch, context);

    // Guard: worktree must be clean (committed by finishTurn)
    const worktreePath = this.deps.gitOps.worktree.getPath(mainCwd, branchName);
    if (await this.deps.gitOps.commit.isDirty(worktreePath)) {
      throw new OrchestratorError(ErrorCode.WORKTREE_DIRTY, "worktree has uncommitted changes — 请先 accept 或 revert 当前修改");
    }

    const preMergeSha = await this.deps.gitOps.snapshot.create(mainCwd);
    const oldMainHead = await this.deps.gitOps.worktree.getHeadSha(mainCwd);

    const result = await this.deps.gitOps.merge.mergeWorktree(mainCwd, branchName, options?.force, this.buildMergeContext(projectId, branchName, context, { worktreePath }));
    mergeLog.info({ success: result.success, hasConflicts: !!result.conflicts?.length }, "handleMerge: mergeWorktree completed");

    if (result.success) {
      const newMainHead = await this.deps.gitOps.worktree.getHeadSha(mainCwd);
      const syncReport = await this.syncMergedAndFollowerThreads({ projectId, branchName, oldMainHead, newMainHead, context });
      if (syncReport.mergedThreadFailure || syncReport.followersFailed.length > 0) {
        const warnings = [
          syncReport.mergedThreadFailure ? `merged thread sync failed: ${syncReport.mergedThreadFailure}` : null,
          syncReport.followersFailed.length > 0 ? `follower sync failed: ${syncReport.followersFailed.map((item) => `${item.threadName}(${item.reason})`).join(', ')}` : null,
        ].filter(Boolean).join('; ');
        result.message = [result.message, warnings].filter(Boolean).join('\n');
      }
    }

    if (result.success && this.deps.snapshotRepo) {
      const mainThreadId = MAIN_THREAD_NAME;
      const turnId = `merge-${branchName}-${Date.now()}`;
      await this.deps.gitOps.snapshot.pin(mainCwd, preMergeSha, `codex-merge-${branchName}`);
      const turnIndex = (await this.deps.snapshotRepo.getLatestIndex(projectId, mainThreadId)) + 1;
      await this.deps.snapshotRepo.save({
        projectId, threadId: mainThreadId, turnId, turnIndex,
        cwd: mainCwd, gitRef: preMergeSha,
        agentSummary: `合并分支: ${branchName}`,
        createdAt: new Date().toISOString()
      });
    }

    if (result.success) {
      // Thread cleanup deferred to user action (keep/delete buttons on merge card)
      // await this.deps.threadService.markMerged(projectId, branchName);
    }

    return result;
  }

  /* ── Per-file merge review methods ──────────────────────────────────── */

  private projectThreadMergeKey(projectId: string, branchName: string): string {
    return `${projectId}:session:${branchName}`;
  }

  /** Schedule auto-abort for a session after timeout. */
  private scheduleSessionTimeout(mergeSessionKey: string, session: MergeSession): void {
    session.timeoutTimer = setTimeout(async () => {
      const s = this.mergeSessions.get(mergeSessionKey);
      if (!s) return;
      const runtimeContext = this.sessionRuntimeContext(s);
      const mergeLog = this.mergeLogger(s.projectId, s.branchName, runtimeContext, { worktreePath: s.worktreeCwd });
      mergeLog.warn("merge session timed out, auto-aborting");
      await this.deps.gitOps.merge.abortSession(s.worktreeCwd, this.buildMergeContext(s.projectId, s.branchName, runtimeContext, { worktreePath: s.worktreeCwd }));
      this.mergeSessions.delete(mergeSessionKey);
      await this.deletePersistedSession(s.projectId, s.branchName);
      // Path B convergence: route timeout through AgentEventRouter
      await this.deps.turnPipeline.routeMessage(s.projectId, {
        kind: "merge_event",
        data: { action: "timeout", projectId: s.projectId, branchName: s.branchName }
      });
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

  private async persistSession(session: MergeSession): Promise<void> {
    await this.deps.mergeSessionRepository?.upsert(toPersistedMergeSessionRecord(session));
  }

  private async deletePersistedSession(projectId: string, branchName: string): Promise<void> {
    await this.deps.mergeSessionRepository?.delete(projectId, branchName);
  }

  private async getOrLoadSession(projectId: string, branchName: string): Promise<MergeSession | undefined> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const existing = this.mergeSessions.get(mergeSessionKey);
    if (existing) return existing;

    const persisted = await this.deps.mergeSessionRepository?.get(projectId, branchName);
    if (!persisted) return undefined;

    const restored = fromPersistedMergeSessionRecord(persisted);
    if (restored.state !== "recovery_required") {
      try {
        await this.validateSessionForRecovery(restored);
      } catch (error) {
        restored.state = "recovery_required";
        restored.recoveryError = error instanceof Error ? error.message : String(error);
      }
    }
    this.mergeSessions.set(mergeSessionKey, restored);
    this.scheduleSessionTimeout(mergeSessionKey, restored);
    await this.persistSession(restored);
    return restored;
  }

  private async listPersistedProjectSessions(projectId: string): Promise<PersistedMergeSessionRecord[]> {
    if (!this.deps.mergeSessionRepository) {
      return [];
    }
    return this.deps.mergeSessionRepository.listActive([projectId]);
  }

  private async assertNoPersistedMergeBlockers(projectId: string, branchName: string): Promise<void> {
    const records = await this.listPersistedProjectSessions(projectId);
    if (records.length === 0) {
      return;
    }

    const sameBranchRecord = records.find((record) => record.branchName === branchName);
    if (sameBranchRecord) {
      const session = await this.getOrLoadSession(projectId, branchName);
      if (session?.state === "recovery_required") {
        throw new OrchestratorError(
          ErrorCode.MERGE_IN_PROGRESS,
          `该分支的合并审阅需要先回滚恢复: ${session.recoveryError ?? "unknown error"}`
        );
      }
      throw new OrchestratorError(ErrorCode.MERGE_IN_PROGRESS, "该分支已有正在进行的合并审阅");
    }

    const activeRecord = records[0];
    throw new OrchestratorError(
      ErrorCode.MERGE_IN_PROGRESS,
      `已有分支 ${activeRecord.branchName} 正在合并审阅中，请先完成或取消`
    );
  }

  private async validateSessionForRecovery(session: MergeSession): Promise<MergeSession> {
    try {
      await this.deps.gitOps.accessCheck(session.worktreeCwd);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`worktree missing: ${session.worktreeCwd}; ${reason}`);
    }

    const currentBranch = await this.deps.gitOps.repo.getCurrentBranch(session.worktreeCwd);
    if (currentBranch !== session.branchName) {
      throw new Error(`worktree branch mismatch: expected ${session.branchName}, got ${currentBranch}`);
    }

    if (session.state === "resolving") {
      const { resolved } = await this.deps.gitOps.merge.checkResolved(
        session.worktreeCwd,
        this.buildMergeContext(session.projectId, session.branchName, this.sessionRuntimeContext(session), { worktreePath: session.worktreeCwd })
      );
      for (const file of session.files) {
        if (file.status === "agent_pending") {
          file.status = "conflict";
        }
      }
      session.state = "reviewing";
      if (resolved) {
        for (const file of session.files) {
          if (file.status === "conflict" && file.decision === "pending") {
            file.status = "agent_resolved";
          }
        }
      }
    }

    const nextIdx = firstPendingIndex(session);
    session.currentIndex = nextIdx >= 0 ? nextIdx : Math.max(0, session.currentIndex);
    return session;
  }

  private mergeResolverName(branchName: string): string {
    return `merge-${branchName}`;
  }

  private async ensureResolverThreadRecord(session: MergeSession, resolverName: string, threadId: string, backend: ThreadRecord["backend"]): Promise<void> {
    const mergeLog = this.mergeLogger(session.projectId, session.branchName, this.sessionRuntimeContext(session), { worktreePath: session.worktreeCwd });
    const existing = await this.deps.threadService.getRecord(session.projectId, resolverName);
    if (!existing) {
      await this.deps.threadService.register({
        projectId: session.projectId,
        threadName: resolverName,
        threadId,
        backend,
        worktreePath: session.worktreeCwd,
      });
      mergeLog.info({
        resolverName,
        resolverThreadId: threadId,
        branchThreadName: session.branchName,
        sharedWorktreePath: session.worktreeCwd,
        backendId: backend.backendId,
        model: backend.model,
      }, "ensureResolverThreadRecord: registered resolver thread with shared worktree");
      return;
    }
    if (existing.threadId !== threadId) {
      throw new Error(
        `merge resolver thread record mismatch: projectId=${session.projectId} threadName=${resolverName} recordThreadId=${existing.threadId} backendThreadId=${threadId}`
      );
    }
    if (existing.backend.backendId !== backend.backendId || existing.backend.model !== backend.model) {
      throw new Error(
        `merge resolver backend mismatch: projectId=${session.projectId} threadName=${resolverName} recordBackend=${existing.backend.backendId}/${existing.backend.model} requestedBackend=${backend.backendId}/${backend.model}`
      );
    }
    if (existing.worktreePath && existing.worktreePath !== session.worktreeCwd) {
      throw new Error(
        `merge resolver worktree mismatch: projectId=${session.projectId} threadName=${resolverName} recordWorktreePath=${existing.worktreePath} sessionWorktreePath=${session.worktreeCwd}`
      );
    }
    await this.deps.threadService.updateRecordRuntime(session.projectId, resolverName, {
      worktreePath: session.worktreeCwd,
    });
    mergeLog.info({
      resolverName,
      resolverThreadId: threadId,
      branchThreadName: session.branchName,
      sharedWorktreePath: session.worktreeCwd,
    }, "ensureResolverThreadRecord: refreshed resolver shared-worktree binding");
  }

  private async ensureMergeResolver(session: MergeSession): Promise<{ api: AgentApi; threadId: string; resolverName: string }> {
    const resolverName = session.resolverName?.trim() || this.mergeResolverName(session.branchName);
    const runtimeContext = this.sessionRuntimeContext(session);
    const mergeLog = this.mergeLogger(session.projectId, session.branchName, runtimeContext, { worktreePath: session.worktreeCwd });

    // Determine backend identity
    const branchRecord = await this.deps.threadService.getRecord(session.projectId, session.branchName);
    const backend = session.resolverBackendId && session.resolverModel && isBackendId(session.resolverBackendId)
      ? createBackendIdentity(session.resolverBackendId, session.resolverModel)
      : branchRecord?.backend;
    if (!backend) {
      throw new Error(`merge resolver backend missing: project=${session.projectId} branch=${session.branchName}`);
    }
    mergeLog.info({
      resolverName,
      branchThreadName: session.branchName,
      sharedWorktreePath: session.worktreeCwd,
      backendId: backend.backendId,
      model: backend.model,
      existingResolverThreadId: session.threadId,
    }, "ensureMergeResolver: ensuring resolver API on shared worktree");

    // Use unified config resolution (fixes serverCmd mismatch bug)
    const { config, api } = await this.deps.threadRuntimeService.ensureApi({
      projectId: session.projectId,
      threadName: resolverName,
      backend,
      overrides: { cwd: session.worktreeCwd, approvalPolicy: "on-request" },
    });

    let threadId = session.resolverName === resolverName ? session.threadId : undefined;
    if (threadId && api.threadResume) {
      try {
        const resumed = await api.threadResume(threadId, config);
        threadId = resumed.thread.id;
        await this.ensureResolverThreadRecord(session, resolverName, threadId, backend);
        session.threadId = threadId;
        session.resolverName = resolverName;
        mergeLog.info({
          resolverName,
          resolverThreadId: threadId,
          sharedWorktreePath: session.worktreeCwd,
        }, "ensureMergeResolver: resumed resolver thread on shared worktree");
        return { api, threadId: threadId!, resolverName };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("thread not found")) {
          throw error;
        }
      }
    }

    const created = await api.threadStart(config);
    threadId = created.thread.id;
    await this.ensureResolverThreadRecord(session, resolverName, threadId, backend);
    session.threadId = threadId;
    session.resolverName = resolverName;
    mergeLog.info({
      resolverName,
      resolverThreadId: threadId,
      sharedWorktreePath: session.worktreeCwd,
    }, "ensureMergeResolver: started resolver thread on shared worktree");
    return { api, threadId: threadId!, resolverName };
  }

  private async restoreWorktreeToPreMergeState(session: MergeSession, context?: MergeRuntimeContext): Promise<void> {
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const logContext = this.buildMergeContext(session.projectId, session.branchName, runtimeContext, { worktreePath: session.worktreeCwd });

    try {
      await this.deps.gitOps.merge.abortSession(session.worktreeCwd, logContext);
    } catch (error) {
      this.mergeLogger(session.projectId, session.branchName, runtimeContext, { worktreePath: session.worktreeCwd })
        .warn({ err: error instanceof Error ? error.message : String(error) }, "restoreWorktreeToPreMergeState: abort failed, will rebuild worktree");
    }

    const currentBranch = await this.deps.gitOps.repo.getCurrentBranch(session.worktreeCwd);
    const dirty = await this.deps.gitOps.commit.isDirty(session.worktreeCwd);
    const { resolved } = await this.deps.gitOps.merge.checkResolved(session.worktreeCwd, logContext);

    if (currentBranch === session.branchName && !dirty && resolved) {
      return;
    }

    await this.deps.gitOps.worktree.remove(session.mainCwd, session.worktreeCwd);
    await this.deps.gitOps.worktree.create(session.mainCwd, session.branchName, session.worktreeCwd, {
      pluginDirs: ALL_BACKEND_SKILL_DIRS,
    });
  }

  private async assertSessionConsistentForCommit(session: MergeSession, context?: MergeRuntimeContext): Promise<void> {
    if (session.state === "recovery_required") {
      throw new Error(`merge session requires recovery: ${session.recoveryError ?? "unknown error"}`);
    }
    const currentBranch = await this.deps.gitOps.repo.getCurrentBranch(session.worktreeCwd);
    if (currentBranch !== session.branchName) {
      throw new Error(`worktree branch mismatch before commit: expected ${session.branchName}, got ${currentBranch}`);
    }
    const { resolved, remaining } = await this.deps.gitOps.merge.checkResolved(
      session.worktreeCwd,
      this.buildMergeContext(session.projectId, session.branchName, this.sessionRuntimeContext(session, context), { worktreePath: session.worktreeCwd })
    );
    if (!resolved) {
      throw new Error(`git index still has unresolved conflicts: ${remaining.join(", ")}`);
    }
  }

  getMergeSession(projectId: string, branchName: string): MergeSession | undefined {
    return this.mergeSessions.get(this.projectThreadMergeKey(projectId, branchName));
  }

  async getMergeReview(projectId: string, branchName: string): Promise<IMFileMergeReview> {
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    return buildFileReview(session);
  }

  /**
   * Start a per-file merge review (PR-style).
   * Merges main into the branch worktree.
   * If conflicts exist → store session as 'resolving', return conflict list.
   * If no conflicts → store session as 'reviewing', return first file review.
   */
  async startMergeReview(
    projectId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview> {
    const mergeLog = this.mergeLogger(projectId, branchName, context);
    const runtimeConfig = await this.deps.runtimeConfigProvider.getProjectRuntimeConfig(projectId);
    const mainCwd = runtimeConfig.cwd;
    const baseBranch = this.requireBaseBranch(projectId, branchName, runtimeConfig, context);
    if (!mainCwd) throw new Error("project has no cwd configured");
    await this.assertMainRepoOnBaseBranch(projectId, branchName, mainCwd, baseBranch, context);

    // Guard: persisted/in-memory session state must be cleared before a new review starts.
    await this.assertNoPersistedMergeBlockers(projectId, branchName);

    // Guard: worktree must be clean
    const worktreeCwd = this.deps.gitOps.worktree.getPath(mainCwd, branchName);
    if (await this.deps.gitOps.commit.isDirty(worktreeCwd)) {
      throw new OrchestratorError(ErrorCode.WORKTREE_DIRTY, "worktree has uncommitted changes — 请先 accept 或 revert 当前修改");
    }

    // PR-style: merge main into the branch worktree
    const { files, preMergeSha } = await this.deps.gitOps.merge.startSession(worktreeCwd, baseBranch, this.buildMergeContext(projectId, branchName, context, { worktreePath: worktreeCwd }));

    if (files.length === 0) {
      await this.deps.gitOps.merge.abortSession(worktreeCwd, this.buildMergeContext(projectId, branchName, context, { worktreePath: worktreeCwd }));
      throw new OrchestratorError(ErrorCode.MERGE_NO_CHANGES, "分支没有需要合并的变更");
    }

    const conflictFiles = files.filter(f => f.status === "conflict");
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const branchRecord = await this.deps.threadService.getRecord(projectId, branchName);
    const chatId = await this.requireProjectChatId(projectId);

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
      resolverName: context?.resolverName,
      resolverBackendId: branchRecord?.backend?.backendId,
      resolverModel: branchRecord?.backend?.model,
    };

    session.currentIndex = firstPendingIndex(session);

    this.mergeSessions.set(mergeSessionKey, session);
    this.scheduleSessionTimeout(mergeSessionKey, session);
    await this.persistSession(session);

    mergeLog.info({
      totalFiles: files.length,
      conflicts: conflictFiles.length,
      worktreePath: worktreeCwd,
      branchThreadName: branchName,
      resolverThreadName: this.mergeResolverName(branchName),
      sharedWorktree: true,
    }, "startMergeReview: entering shared-worktree review");
    return buildFileReview(session);
  }

  /**
   * Batch conflict resolution entry.
   * The current flow is manual-first and uses per-file agent retry from reviewing state.
   */
  async resolveConflictsViaAgent(projectId: string, branchName: string, prompt?: string, context?: MergeRuntimeContext): Promise<IMFileMergeReview> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    const runtimeContext = session ? this.sessionRuntimeContext(session, context) : context;
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, session ? { worktreePath: session.worktreeCwd } : undefined);
    if (!session) {
      mergeLog.error("resolveConflictsViaAgent: no active merge session");
      throw new Error("没有正在进行的合并审阅");
    }
    if (session.state === "recovery_required") {
      throw new Error(`merge session requires recovery: ${session.recoveryError ?? "unknown error"}`);
    }
    const conflictFiles = session.files.filter((f) => f.decision === "pending" && f.status === "conflict");
    if (conflictFiles.length === 0) {
      mergeLog.info("resolveConflictsViaAgent: no pending conflict files");
      return buildFileReview(session);
    }
    if (session.state === "resolving") {
      mergeLog.info("resolveConflictsViaAgent: already resolving conflicts");
      return buildFileReview(session);
    }

    try {
      session.state = "resolving";
      const { api, threadId, resolverName } = await this.ensureMergeResolver(session);

      const fullPrompt = [
        `你正在解决 main 分支合并到分支 "${branchName}" 时产生的冲突。`,
        `工作目录: ${session.worktreeCwd}`,
        ``,
        `以下文件存在冲突，请逐一编辑并移除冲突标记 (<<<<<<< ======= >>>>>>>):`,
        ...conflictFiles.map(f => `- ${f.path}`),
        ``,
        prompt?.trim() ? `额外要求:\n${prompt.trim()}\n` : "",
        `完成每个文件后，运行: git add <filename>`,
        `请确保合并结果保留双方的有效修改，使代码功能完整且可编译。`,
      ].filter(Boolean).join("\n");

      const resolverRoute = {
        projectId: session.projectId,
        userId: runtimeContext?.userId,
        traceId: runtimeContext?.traceId,
        threadName: resolverName,
        threadId,
        cwd: session.worktreeCwd,
      };
      this.deps.turnPipeline.prepareTurn(resolverRoute);
      const started = await api.turnStart({
        threadId,
        input: [{ type: "text", text: fullPrompt }]
      });
      const turnId = started.turn.id;
      this.deps.turnPipeline.registerTurnCompleteHook(session.projectId, resolverName, async () => {
        await this.onMergeResolverDone(session.projectId, branchName, runtimeContext);
      });
      this.deps.turnPipeline.activateTurn({ ...resolverRoute, turnId });

      session.turnId = turnId;
      session.threadId = threadId;
      session.resolverName = resolverName;
      session.traceId = runtimeContext?.traceId ?? session.traceId;
      session.userId = runtimeContext?.userId ?? session.userId;
      await this.persistSession(session);
      mergeLog.info({
        conflicts: conflictFiles.length,
        turnId,
        threadId,
        resolverName,
        branchThreadName: session.branchName,
        sharedWorktreePath: session.worktreeCwd,
      }, "resolveConflictsViaAgent: Agent turn started on shared worktree");
      return buildFileReview(session);
    } catch (err) {
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "resolveConflictsViaAgent: failed to start Agent turn");
      session.state = "reviewing";
      await this.persistSession(session);
      await this.deps.turnPipeline.routeMessage(session.projectId, {
        kind: "merge_event",
        data: { action: "resolver_done", projectId: session.projectId, branchName, review: buildFileReview(session) }
      });
      throw new Error("批量 Agent 冲突处理启动失败");
    }
  }

  async configureMergeResolver(
    projectId: string,
    branchName: string,
    backendId: string,
    model: string
  ): Promise<void> {
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    if (!isBackendId(backendId)) {
      throw new Error(`unsupported backend: ${backendId}`);
    }
    if (!model.trim()) {
      throw new Error("model is required");
    }
    session.resolverBackendId = backendId;
    session.resolverModel = model.trim();
    await this.persistSession(session);
  }

  /**
   * Phase 2: Called when the Agent's conflict resolution turn completes.
   * Re-reads file diffs, updates statuses, transitions to reviewing.
   */
  async onMergeResolverDone(projectId: string, branchName: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    const runtimeContext = session ? this.sessionRuntimeContext(session, context) : context;
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, session ? { worktreePath: session.worktreeCwd } : undefined);
    if (!session) {
      mergeLog.warn("onMergeResolverDone: no session");
      return;
    }

    let resolved = false;
    let remaining: string[] = [];
    try {
      ({ resolved, remaining } = await this.deps.gitOps.merge.checkResolved(
        session.worktreeCwd,
        this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd })
      ));
      const remainingSet = new Set(remaining);

      // Re-check each conflict file
      for (const file of session.files) {
        if (file.status === "conflict") {
          if (!remainingSet.has(file.path)) {
            file.status = "agent_resolved";
            file.agentAttempts++;
            file.diff = await this.readFileDiff(projectId, session.worktreeCwd, branchName, file.path, runtimeContext);
          }
        }
      }
      mergeLog.info({ resolved, remaining }, "onMergeResolverDone: transitioned to reviewing");
    } catch (err) {
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "onMergeResolverDone: post-turn refresh failed");
      await this.deps.turnPipeline.routeMessage(session.projectId, {
        kind: "notification",
        threadId: session.threadId ?? "",
        category: "warning",
        title: "Agent 合并结果刷新失败",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      session.state = "reviewing";
      session.activeAgentFilePath = undefined;
      session.agentRetryBaseline = undefined;
      session.currentIndex = firstPendingIndex(session);
      await this.persistSession(session);
    }

    // Path B convergence: route review through AgentEventRouter
    await this.deps.turnPipeline.routeMessage(session.projectId, {
      kind: "merge_event",
      data: { action: "resolver_done", projectId: session.projectId, branchName, review: buildFileReview(session) }
    });
  }

  /**
   * Phase 2: Reject an agent-resolved file with feedback, trigger Agent retry.
   */
  async retryFileWithAgent(
    projectId: string, branchName: string, filePath: string, feedback: string, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath });

    const file = session.files.find(f => f.path === filePath);
    if (!file) throw new Error(`文件不在合并列表中: ${filePath}`);
    if (session.state === "recovery_required") throw new Error(`merge session requires recovery: ${session.recoveryError ?? "unknown error"}`);
    if (session.state === "resolving") throw new Error("Agent 正在批量处理冲突，请等待完成后再继续操作");

    file.lastFeedback = feedback;
    file.status = "agent_pending";
    const currentIndex = session.files.indexOf(file);
    if (currentIndex >= 0) session.currentIndex = currentIndex;
    session.activeAgentFilePath = filePath;
    session.agentRetryBaseline = await this.deps.gitOps.merge.readStatusMap(
      session.worktreeCwd,
      this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath })
    );
    const pendingReview = buildFileReview(session);

    try {
      const { api, threadId, resolverName } = await this.ensureMergeResolver(session);

      const prompt = await buildSingleFileMergeAgentPrompt({
        worktreeCwd: session.worktreeCwd,
        filePath,
        userPrompt: feedback,
      });

      const resolverRoute = {
        projectId: session.projectId,
        userId: runtimeContext?.userId,
        traceId: runtimeContext?.traceId,
        threadName: resolverName,
        threadId,
        cwd: session.worktreeCwd,
      };
      this.deps.turnPipeline.prepareTurn(resolverRoute);
      const started = await api.turnStart({
        threadId,
        input: [{ type: "text", text: prompt }]
      });
      const turnId = started.turn.id;
      this.deps.turnPipeline.registerTurnCompleteHook(session.projectId, resolverName, async () => {
        await this.onMergeFileRetryDone(session.projectId, branchName, filePath, runtimeContext);
      });
      this.deps.turnPipeline.activateTurn({ ...resolverRoute, turnId });

      session.turnId = turnId;
      session.threadId = threadId;
      session.resolverName = resolverName;
      session.traceId = runtimeContext.traceId ?? session.traceId;
      session.userId = runtimeContext.userId ?? session.userId;
      await this.persistSession(session);
      mergeLog.info({ attempt: file.agentAttempts + 1, turnId, threadId }, "retryFileWithAgent: Agent turn started");
      return pendingReview;
    } catch (err) {
      file.status = "conflict";
      session.state = "reviewing";
      session.activeAgentFilePath = undefined;
      session.agentRetryBaseline = undefined;
      await this.persistSession(session);
      await this.deps.turnPipeline.routeMessage(session.projectId, {
        kind: "merge_event",
        data: { action: "resolver_done", projectId: session.projectId, branchName, review: buildFileReview(session) }
      });
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "retryFileWithAgent: Agent turn failed");
      throw new Error("Agent 重试失败，请手动选择 keep_main 或 use_branch");
    }
  }

  /**
   * Phase 2: Called when Agent finishes retrying a specific file.
   */
  async onMergeFileRetryDone(projectId: string, branchName: string, filePath: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) return;
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath });

    const file = session.files.find(f => f.path === filePath);
    if (!file) return;
    try {
      await this.assertAgentRetryScopedToFile(session, filePath, runtimeContext);
      file.agentAttempts++;
      file.diff = await this.readFileDiff(projectId, session.worktreeCwd, branchName, file.path, runtimeContext);
      file.decision = "pending";
      const { remaining } = await this.deps.gitOps.merge.checkResolved(
        session.worktreeCwd,
        this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath })
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
      await this.deps.turnPipeline.routeMessage(session.projectId, {
        kind: "notification",
        threadId: session.threadId ?? "",
        category: "warning",
        title: "Agent 合并结果未通过校验",
        detail: err instanceof Error ? err.message : String(err)
      });
    } finally {
      session.state = "reviewing";
      session.activeAgentFilePath = undefined;
      session.agentRetryBaseline = undefined;
      const idx = session.files.indexOf(file);
      if (idx >= 0) session.currentIndex = idx;
    }

    await this.persistSession(session);

    await this.deps.turnPipeline.routeMessage(session.projectId, {
      kind: "merge_event",
      data: { action: "resolver_done", projectId: session.projectId, branchName, review: buildFileReview(session) }
    });
  }

  /**
   * Phase 2: Batch retry — re-process selected files with Agent and leave unselected files unchanged for this round.
   */
  async retryFilesWithAgent(
    projectId: string, branchName: string, filePaths: string[], feedback: string, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview> {
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });
    if (session.state === "recovery_required") throw new Error(`merge session requires recovery: ${session.recoveryError ?? "unknown error"}`);
    if (session.state === "resolving") throw new Error("Agent 正在批量处理冲突，请等待完成后再继续操作");
    if (filePaths.length === 0) throw new Error("请至少选择 1 个需要继续交给 Agent 修改的文件");

    const targetSet = new Set(filePaths);

    // Mark selected files for retry
    for (const filePath of filePaths) {
      const file = session.files.find(f => f.path === filePath);
      if (!file) throw new Error(`文件不在合并列表中: ${filePath}`);
      file.lastFeedback = feedback;
      file.status = "agent_pending";
    }
    session.state = "resolving";
    session.currentIndex = firstPendingIndex(session);

    session.agentRetryBaseline = await this.deps.gitOps.merge.readStatusMap(
      session.worktreeCwd,
      this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd })
    );
    const pendingReview = buildFileReview(session);

    try {
      const { api, threadId, resolverName } = await this.ensureMergeResolver(session);

      const prompt = await buildBatchFileMergeAgentPrompt({
        worktreeCwd: session.worktreeCwd,
        files: filePaths,
        userPrompt: feedback,
      });

      const resolverRoute = {
        projectId: session.projectId,
        userId: runtimeContext?.userId,
        traceId: runtimeContext?.traceId,
        threadName: resolverName,
        threadId,
        cwd: session.worktreeCwd,
      };
      this.deps.turnPipeline.prepareTurn(resolverRoute);
      const started = await api.turnStart({
        threadId,
        input: [{ type: "text", text: prompt }]
      });
      const turnId = started.turn.id;
      this.deps.turnPipeline.registerTurnCompleteHook(session.projectId, resolverName, async () => {
        await this.onBatchRetryDone(session.projectId, branchName, filePaths, runtimeContext);
      });
      this.deps.turnPipeline.activateTurn({ ...resolverRoute, turnId });

      session.turnId = turnId;
      session.threadId = threadId;
      session.resolverName = resolverName;
      session.traceId = runtimeContext.traceId ?? session.traceId;
      session.userId = runtimeContext.userId ?? session.userId;
      await this.persistSession(session);
      mergeLog.info({ fileCount: filePaths.length, turnId, threadId }, "retryFilesWithAgent: batch Agent turn started");
      return pendingReview;
    } catch (err) {
      for (const filePath of filePaths) {
        const file = session.files.find(f => f.path === filePath);
        if (file) { file.status = "conflict"; }
      }
      session.state = "reviewing";
      session.agentRetryBaseline = undefined;
      await this.persistSession(session);
      await this.deps.turnPipeline.routeMessage(session.projectId, {
        kind: "merge_event",
        data: { action: "resolver_done", projectId: session.projectId, branchName, review: buildFileReview(session) }
      });
      mergeLog.error({ err: err instanceof Error ? err.message : err }, "retryFilesWithAgent: Agent turn failed");
      throw new Error("Agent 批量重试失败，请手动处理");
    }
  }

  /**
   * Phase 2: Called when Agent finishes batch retrying files.
   */
  async onBatchRetryDone(projectId: string, branchName: string, filePaths: string[], context?: MergeRuntimeContext): Promise<void> {
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) return;
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });

    try {
      for (const filePath of filePaths) {
        const file = session.files.find(f => f.path === filePath);
        if (!file) continue;
        try {
          file.agentAttempts++;
          file.diff = await this.readFileDiff(projectId, session.worktreeCwd, branchName, file.path, runtimeContext);
          file.decision = "pending";
          const { remaining } = await this.deps.gitOps.merge.checkResolved(
            session.worktreeCwd,
            this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath })
          );
          file.status = remaining.includes(file.path) ? "conflict" : "agent_resolved";
          mergeLog.info({ filePath, attempt: file.agentAttempts }, "onBatchRetryDone: file re-read");
        } catch (err) {
          file.status = "conflict";
          file.decision = "pending";
          mergeLog.error({ filePath, err: err instanceof Error ? err.message : err }, "onBatchRetryDone: validation failed");
        }
      }
    } finally {
      session.state = "reviewing";
      session.activeAgentFilePath = undefined;
      session.agentRetryBaseline = undefined;
      session.currentIndex = firstPendingIndex(session);
      await this.persistSession(session);
    }
    await this.deps.turnPipeline.routeMessage(session.projectId, {
      kind: "merge_event",
      data: { action: "resolver_done", projectId: session.projectId, branchName, review: buildFileReview(session) }
    });
  }


  /* ── Git helpers for Phase 2 ──────────────────────────────────────── */

  private async readFileDiff(projectId: string, cwd: string, branchName: string, filePath: string, context?: MergeRuntimeContext): Promise<string> {
    return this.deps.gitOps.merge.readFileDiff(cwd, filePath, this.buildMergeContext(projectId, branchName, context, { filePath, worktreePath: cwd }));
  }

  /**
   * Record a user decision for a file, apply it to git, and advance.
   * Returns the next file review, or a summary if all files are done.
   */
  async decideFile(
    projectId: string, branchName: string, filePath: string, decision: MergeFileDecision, context?: MergeRuntimeContext
  ): Promise<IMFileMergeReview | IMMergeSummary> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath });

    // Find and update the file
    const file = session.files.find(f => f.path === filePath);
    if (!file) throw new Error(`文件不在合并列表中: ${filePath}`);
    if (session.state === "recovery_required") throw new Error(`merge session requires recovery: ${session.recoveryError ?? "unknown error"}`);
    if (session.state === "resolving") throw new Error("Agent 正在批量处理冲突，请等待完成后再继续操作");
    if (file.decision !== "pending") return buildFileReview(session); // guard: already decided
    file.decision = decision;

    // Apply the git-level decision (PR-style: worktreeCwd)
    await this.deps.gitOps.merge.applyDecision(
      session.worktreeCwd,
      filePath,
      decision,
      session.baseBranch,
      this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath })
    );
    if (file.status === "conflict" && (decision === "keep_main" || decision === "use_branch")) {
      file.status = "agent_resolved";
    }
    mergeLog.info({ decision }, "decideFile: decision applied");

    // Find next pending file
    const nextIdx = firstPendingIndex(session);
    if (nextIdx === -1) {
      await this.persistSession(session);
      // All files decided → return summary
      return buildMergeSummary(session);
    }

    session.currentIndex = nextIdx;
    await this.persistSession(session);
    return buildFileReview(session);
  }

  /**
   * Accept all remaining pending files at once.
   */
  async acceptAllRemaining(
    projectId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<IMMergeSummary | IMFileMergeReview> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    if (session.state === "recovery_required") throw new Error(`merge session requires recovery: ${session.recoveryError ?? "unknown error"}`);
    if (session.state === "resolving") throw new Error("Agent 正在批量处理冲突，请等待完成后再继续操作");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });

    for (const file of session.files) {
      if (file.decision === "pending") {
        if (file.status === "conflict") continue; // cannot batch-accept unresolved conflicts
        file.decision = "accept";
        await this.deps.gitOps.merge.applyDecision(session.worktreeCwd, file.path, "accept", session.baseBranch, this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd, filePath: file.path }));
      }
    }

    mergeLog.info("acceptAllRemaining: applied to all pending files");
    const nextIdx = firstPendingIndex(session);
    if (nextIdx >= 0) {
      session.currentIndex = nextIdx;
      await this.persistSession(session);
      return buildFileReview(session);
    }
    await this.persistSession(session);
    return buildMergeSummary(session);
  }

  /**
   * Commit the merge session after all decisions are made.
   */
  async commitMergeReview(
    projectId: string, branchName: string, context?: MergeRuntimeContext
  ): Promise<{ success: boolean; message: string }> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) throw new Error("没有正在进行的合并审阅");
    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });
    await this.assertSessionReadyToCommit(session, runtimeContext);
    await this.assertSessionConsistentForCommit(session, runtimeContext);

    // Stage 3: Commit merge in worktree
    const oldMainHead = await this.deps.gitOps.worktree.getHeadSha(session.mainCwd);
    const result = await this.deps.gitOps.merge.commitSession(session.worktreeCwd, branchName, session.baseBranch, undefined, this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd }));

    // Log decision summary for audit
    const decisionSummary = session.files.reduce((acc, f) => {
      const d = f.decision === "pending" ? "skip" : f.decision;
      acc[d] = (acc[d] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    mergeLog.info({ decisions: decisionSummary, success: result.success }, "commitMergeReview: worktree committed");

    if (result.success) {
      // Pre-check: verify the branch commit includes baseBranch ancestry.
      // Without this, --ff-only would give a cryptic error message.
      const worktreeHead = await this.deps.gitOps.worktree.getHeadSha(session.worktreeCwd);
      const ancestryOk = await this.deps.gitOps.repo.isAncestor(session.worktreeCwd, session.baseBranch, worktreeHead);
      if (!ancestryOk) {
        const msg = `Branch "${branchName}" worktree HEAD (${worktreeHead.slice(0, 8)}) does not include "${session.baseBranch}" ancestry. `
          + `This usually means a premature commit consumed the MERGE_HEAD during the merge session.`;
        mergeLog.error({ worktreeHead, baseBranch: session.baseBranch }, "commitMergeReview: ancestry check failed");
        return { success: false, message: msg };
      }

      // Stage 4: Fast-forward main to the branch
      const ffResult = await this.deps.gitOps.merge.fastForwardMain(session.mainCwd, branchName, session.baseBranch, this.buildMergeContext(projectId, branchName, runtimeContext, { worktreePath: session.mainCwd }));
      if (!ffResult.success) {
        mergeLog.error({ message: ffResult.message }, "commitMergeReview: fast-forward main failed");
        return ffResult;
      }
      mergeLog.info({ mainCwd: session.mainCwd }, "commitMergeReview: main fast-forwarded");

      const newMainHead = await this.deps.gitOps.worktree.getHeadSha(session.mainCwd);
      const syncReport = await this.syncMergedAndFollowerThreads({
        projectId,
        branchName,
        oldMainHead,
        newMainHead,
        context: runtimeContext,
      });
      if (syncReport.mergedThreadFailure || syncReport.followersFailed.length > 0) {
        const warnings = [
          syncReport.mergedThreadFailure ? `merged thread sync failed: ${syncReport.mergedThreadFailure}` : null,
          syncReport.followersFailed.length > 0 ? `follower sync failed: ${syncReport.followersFailed.map((item) => `${item.threadName}(${item.reason})`).join(', ')}` : null,
        ].filter(Boolean).join('; ');
        result.message = [result.message, warnings].filter(Boolean).join('\n');
      }

      // Record snapshot
      if (session.preMergeSha && this.deps.snapshotRepo) {
        const mainThreadId = MAIN_THREAD_NAME;
        const turnId = `merge-${branchName}-${Date.now()}`;
        await this.deps.gitOps.snapshot.pin(session.mainCwd, session.preMergeSha, `codex-merge-${branchName}`);
        const turnIndex = (await this.deps.snapshotRepo.getLatestIndex(session.projectId, mainThreadId)) + 1;
        await this.deps.snapshotRepo.save({
          projectId: session.projectId, threadId: mainThreadId, turnId, turnIndex,
          cwd: session.mainCwd, gitRef: session.preMergeSha,
          agentSummary: `合并分支: ${branchName} (per-file review)`,
          createdAt: new Date().toISOString()
        });
      }

      // Thread cleanup deferred to user action (keep/delete buttons on merge card)
      // await this.deps.gitOps.worktree.remove(session.mainCwd, session.worktreeCwd, branchName);
      // await this.deps.threadService.markMerged(session.projectId, branchName);
    }

    this.clearSessionTimeout(mergeSessionKey);
    this.mergeSessions.delete(mergeSessionKey);
    await this.deletePersistedSession(session.projectId, branchName);
    await this.cleanupResolverThread(session);
    return result;
  }

  /**
   * Clean up resolver thread resources (worktree, backend, registry).
   * Non-critical: failures are logged but do not block the caller.
   */
  private async cleanupResolverThread(session: MergeSession): Promise<void> {
    if (!session.resolverName) return;
    const mergeLog = this.mergeLogger(session.projectId, session.branchName, undefined, { worktreePath: session.worktreeCwd });
    mergeLog.info({
      resolverName: session.resolverName,
      branchThreadName: session.branchName,
      sharedWorktreePath: session.worktreeCwd,
    }, "cleanupResolverThread: starting logical resolver cleanup for shared worktree");
    // 1. Release backend process
    try {
      await this.deps.threadRuntimeService.releaseThread(session.projectId, session.resolverName);
      mergeLog.info({ resolverName: session.resolverName }, "cleanupResolverThread: released backend");
    } catch (err) {
      mergeLog.warn({ err: err instanceof Error ? err.message : String(err), resolverName: session.resolverName },
        "cleanupResolverThread: releaseThread failed");
    }
    // 2. Resolver thread reuses the merge review worktree (session.worktreeCwd).
    // Do not remove any worktree here, or we may delete the branch review workspace
    // that is still owned by the main merge thread and controlled by user keep/delete actions.
    mergeLog.info({
      resolverName: session.resolverName,
      sharedWorktreePath: session.worktreeCwd,
    }, "cleanupResolverThread: skipped worktree removal because resolver uses shared merge worktree");
    // 3. Clean up thread registry
    try {
      await this.deps.threadService.markMerged(session.projectId, session.resolverName);
    } catch (err) {
      mergeLog.warn({ err: err instanceof Error ? err.message : String(err), resolverName: session.resolverName },
        "cleanupResolverThread: markThreadMerged failed");
    }
  }

  /**
   * Cancel the merge review, aborting the git merge.
   * If a resolver turn is running, it is interrupted first.
   */
  async cancelMergeReview(projectId: string, branchName: string, context?: MergeRuntimeContext): Promise<void> {
    const mergeSessionKey = this.projectThreadMergeKey(projectId, branchName);
    const session = await this.getOrLoadSession(projectId, branchName);
    if (!session) return;

    const runtimeContext = this.sessionRuntimeContext(session, context);
    const mergeLog = this.mergeLogger(projectId, branchName, runtimeContext, { worktreePath: session.worktreeCwd });

    // 1. Cancel any pending resolver completion hook and interrupt the active resolver turn if running.
    if (session.resolverName) {
      this.deps.turnPipeline.unregisterTurnCompleteHook(projectId, session.resolverName);
    }
    if (session.resolverName && session.turnId) {
      try {
        await this.deps.interruptThread(projectId, session.resolverName, {
          threadId: session.threadId,
          turnId: session.turnId,
        });
        mergeLog.info({ resolverName: session.resolverName, turnId: session.turnId }, "cancelMergeReview: interrupted resolver thread");
      } catch (err) {
        mergeLog.warn({ err: err instanceof Error ? err.message : String(err) }, "cancelMergeReview: interrupt failed");
      }
    }
    session.turnId = undefined;
    await this.persistSession(session);

    // 2. Restore branch worktree to pre-merge state
    await this.restoreWorktreeToPreMergeState(session, runtimeContext);

    // 3. Clean up resolver thread resources
    await this.cleanupResolverThread(session);

    // 4. Clean up session state
    this.clearSessionTimeout(mergeSessionKey);
    this.mergeSessions.delete(mergeSessionKey);
    await this.deletePersistedSession(session.projectId, branchName);
    mergeLog.info("cancelMergeReview: session cancelled");
  }

  async recoverSessions(activeProjectIds: string[]): Promise<{ recovered: number; failed: number; failures: Array<{ projectId: string; branchName: string; reason: string }> }> {
    if (!this.deps.mergeSessionRepository) {
      return { recovered: 0, failed: 0, failures: [] };
    }
    const records = await this.deps.mergeSessionRepository.listActive(activeProjectIds);
    let recovered = 0;
    let failed = 0;
    const failures: Array<{ projectId: string; branchName: string; reason: string }> = [];

    for (const record of records) {
      try {
        const session = await this.validateSessionForRecovery(fromPersistedMergeSessionRecord(record));
        const mergeSessionKey = this.projectThreadMergeKey(session.projectId, session.branchName);
        this.clearSessionTimeout(mergeSessionKey);
        this.mergeSessions.set(mergeSessionKey, session);
        this.scheduleSessionTimeout(mergeSessionKey, session);
        await this.persistSession(session);
        recovered++;
      } catch (error) {
        const recoveryRequired = fromPersistedMergeSessionRecord(record);
        recoveryRequired.state = "recovery_required";
        recoveryRequired.recoveryError = error instanceof Error ? error.message : String(error);
        await this.deps.mergeSessionRepository.upsert(toPersistedMergeSessionRecord(recoveryRequired));
        failed++;
        failures.push({
          projectId: record.projectId,
          branchName: record.branchName,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { recovered, failed, failures };
  }

  /* ── L1 aliases (proxy name → internal name) ── */

  mergeDecideFile(projectId: string, branchName: string, filePath: string, decision: "accept" | "keep_main" | "use_branch" | "skip", context?: MergeRuntimeContext) {
    return this.decideFile(projectId, branchName, filePath, decision, context);
  }

  mergeAcceptAll(projectId: string, branchName: string, context?: MergeRuntimeContext) {
    return this.acceptAllRemaining(projectId, branchName, context);
  }

  retryMergeFile(projectId: string, branchName: string, filePath: string, feedback: string, context?: MergeRuntimeContext) {
    return this.retryFileWithAgent(projectId, branchName, filePath, feedback, context);
  }

  retryMergeFiles(projectId: string, branchName: string, filePaths: string[], feedback: string, context?: MergeRuntimeContext) {
    return this.retryFilesWithAgent(projectId, branchName, filePaths, feedback, context);
  }
}
