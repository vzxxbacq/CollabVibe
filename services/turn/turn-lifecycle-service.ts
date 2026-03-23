import { createLogger } from "../../packages/logger/src/index";

import type { AgentApi, RuntimeConfigProvider, AgentTurnInputItem } from "../../packages/agent-core/src/index";
import type { ThreadRegistry } from "../thread/contracts";
import type { EventPipeline, RouteBinding, ThreadRouteBinding } from "../event/pipeline";
import { ThreadService } from "../thread/thread-service";
import type { TurnDiffResult } from "../../packages/git-utils/src/index";
import type { GitOps } from "../../packages/git-utils/src/index";
import type { PluginService } from "../plugin/plugin-service";
import { TurnQueryService } from "../turn/turn-query-service";
import { TurnCommandService } from "../turn/turn-command-service";

import { OrchestratorError, ErrorCode } from "../errors";
import { parseMergeResolverName } from "../merge/merge-naming";
import type { ProjectThreadKey } from "../session/session-state-service";
import { projectThreadKey } from "../session/session-state-service";
import type { ProjectResolver } from "../project/project-resolver";
import { ThreadRuntimeService } from "../thread/thread-runtime-service";
import { SessionStateService } from "../session/session-state-service";
import { buildTurnCallId } from "./call-id";

const log = createLogger("turn-lifecycle");


export interface TurnLifecycleDeps {
  sessionStateService: SessionStateService;
  threadService: ThreadService;
  threadRuntimeService: ThreadRuntimeService;
  turnCommandService: TurnCommandService;
  turnQueryService: TurnQueryService;
  pluginService?: PluginService;
  runtimeConfigProvider: RuntimeConfigProvider;
  projectResolver: ProjectResolver;
  threadRegistry: ThreadRegistry;
  gitOps: GitOps;
}

interface TurnStartPersistenceInput {
  projectId: string;
  userId?: string;
  traceId?: string;
  threadName: string;
  threadId: string;
  turnId: string;
  callId?: string;
  platform?: string;
  sourceMessageId?: string;
  turnMode?: "plan";
  promptSummary?: string;
}

/**
 * TurnLifecycleService — owns the full turn lifecycle:
 *   • handleUserTextForUser: start a turn from user input
 *   • finishTurn: commit worktree changes and compute diff
 *   • handleTurnInterrupt: interrupt a running turn
 *   • handleRollback: revert the last completed turn
 *
 * Extracted from orchestrator.ts (C3).
 */
export class TurnLifecycleService {
  private readonly sessionStateService: SessionStateService;
  private readonly threadService: ThreadService;
  private readonly threadRuntimeService: ThreadRuntimeService;
  private readonly turnCommandService: TurnCommandService;
  private readonly turnQueryService: TurnQueryService;
  private readonly pluginService?: PluginService;
  private readonly runtimeConfigProvider: RuntimeConfigProvider;
  private readonly projectResolver: ProjectResolver;
  private readonly threadRegistry: ThreadRegistry;
  private readonly gitOps: GitOps;
  private eventPipeline?: EventPipeline;
  private readonly callStartInflight = new Map<string, Promise<{ threadId: string; turnId: string; status: "started" }>>();

  constructor(deps: TurnLifecycleDeps) {
    this.sessionStateService = deps.sessionStateService;
    this.threadService = deps.threadService;
    this.threadRuntimeService = deps.threadRuntimeService;
    this.turnCommandService = deps.turnCommandService;
    this.turnQueryService = deps.turnQueryService;
    this.pluginService = deps.pluginService;
    this.runtimeConfigProvider = deps.runtimeConfigProvider;
    this.projectResolver = deps.projectResolver;
    this.threadRegistry = deps.threadRegistry;
    this.gitOps = deps.gitOps;
  }

  /** Late injection to break circular dep: pipeline needs orchestrator callbacks. */
  setEventPipeline(pipeline: EventPipeline): void {
    this.eventPipeline = pipeline;
  }

  /* ── public turn use cases ── */

  async handleUserTextForUser(
    projectId: string, userId: string, text: string, traceId?: string,
    options?: { mode?: "plan"; platform?: string; messageId?: string }
  ): Promise<{ threadId: string; turnId: string; status: "started" | "duplicate" }> {
    const projectIdResolved = this.requireProjectId(projectId);
    const binding = await this.threadService.getUserBinding(projectIdResolved, userId);
    if (!binding) {
      throw new OrchestratorError(ErrorCode.NO_ACTIVE_THREAD, "请先 /thread new 或 /thread join");
    }

    const platform = options?.platform;
    const messageId = options?.messageId;
    const callId = platform && messageId
      ? buildTurnCallId({ platform, projectId: projectIdResolved, messageId })
      : undefined;
    if (callId) {
      const existing = await this.turnQueryService.getTurnRecordByCallId(projectIdResolved, callId);
      if (existing) {
        log.info({
          projectId: projectIdResolved,
          threadName: existing.threadName,
          platform,
          messageId,
          callId,
          existingTurnId: existing.turnId,
          dedupHit: true,
        }, "turn start skipped: duplicate callId");
        return { threadId: existing.threadId, turnId: existing.turnId, status: "duplicate" };
      }
      const inflightKey = `${projectIdResolved}:${callId}`;
      const pending = this.callStartInflight.get(inflightKey);
      if (pending) {
        const started = await pending;
        log.info({
          projectId: projectIdResolved,
          threadName: binding.threadName,
          platform,
          messageId,
          callId,
          existingTurnId: started.turnId,
          dedupHit: true,
        }, "turn start skipped: duplicate callId");
        return { ...started, status: "duplicate" };
      }
      const task = this.startUserTurn(projectIdResolved, userId, text, traceId, binding.threadName, binding.threadId, {
        mode: options?.mode,
        callId,
        platform,
        sourceMessageId: messageId,
      });
      this.callStartInflight.set(inflightKey, task);
      try {
        const started = await task;
        return { ...started, status: "started" };
      } finally {
        this.callStartInflight.delete(inflightKey);
      }
    }
    const started = await this.startUserTurn(projectIdResolved, userId, text, traceId, binding.threadName, binding.threadId, {
      mode: options?.mode,
    });
    return { ...started, status: "started" };
  }

  private async startUserTurn(
    projectIdResolved: string,
    userId: string,
    text: string,
    traceId: string | undefined,
    threadName: string,
    threadId: string,
    options?: { mode?: "plan"; callId?: string; platform?: string; sourceMessageId?: string }
  ): Promise<{ threadId: string; turnId: string; status: "started" }> {
    const key = projectThreadKey(projectIdResolved, threadName);
    try {
      this.sessionStateService.ensureCanStartTurn(key);
      await this.pluginService?.ensureProjectThreadSkills?.(projectIdResolved, threadName);

      const api = await this.resolveAgentApi(projectIdResolved, threadName);

      // Plan mode — switch agent to plan mode before turn
      if (options?.mode === "plan" && api.setMode) {
        await api.setMode("plan");
      }

      const turnRouteBase = {
        projectId: projectIdResolved,
        userId,
        traceId,
        threadName,
        threadId,
        turnMode: options?.mode === "plan" ? "plan" : undefined
      } satisfies ThreadRouteBinding;

      const makeTurnParams = (threadId: string) => {
        const input: AgentTurnInputItem[] = [{ type: "text", text }];
        const params: { threadId: string; traceId?: string; input: AgentTurnInputItem[] } = {
          threadId, input
        };
        if (traceId) params.traceId = traceId;
        return params;
      };

      let turn: { turn: { id: string } };
      let activeThreadId = threadId;
      try {
        const started = await this.runTurnWithLifecycle(
          { ...turnRouteBase, threadId: activeThreadId },
          async () => {
            const turnResult = await api.turnStart(makeTurnParams(activeThreadId));
            return {
              turnId: turnResult.turn.id,
              value: turnResult,
              callId: options?.callId,
              platform: options?.platform,
              sourceMessageId: options?.sourceMessageId,
            };
          }
        );
        turn = started.value;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes("thread not found") || errMsg.includes("not found")) {
          log.info({ threadId: activeThreadId }, "thread lost, auto-resuming");
          const runtimeConfig = await this.runtimeConfigProvider.getProjectRuntimeConfig(projectIdResolved, userId);
          if (!api.threadResume) throw new OrchestratorError(ErrorCode.RESUME_NOT_SUPPORTED, "thread lost and backend does not support resume");
          let resumed;
          try {
            resumed = await api.threadResume(activeThreadId, runtimeConfig);
          } catch (resumeError) {
            const resumeMsg = resumeError instanceof Error ? resumeError.message : String(resumeError);
            if (resumeMsg.includes("no rollout found for thread id")) {
              const runtimeState = await this.threadService.getRuntimeState(projectIdResolved, threadName);
              if (!runtimeState?.lastCompletedTurnId) {
                const record = this.threadService.getRecord(projectIdResolved, threadName);
                if (record?.backend.backendId === "codex") {
                  const recreated = await this.reinitializeEmptyCodexThread({
                    projectId: projectIdResolved,
                    threadName,
                    oldThreadId: activeThreadId,
                  });
                  activeThreadId = recreated.threadId;
                  const started = await this.runTurnWithLifecycle(
                    { ...turnRouteBase, threadId: activeThreadId },
                    async () => {
                      const turnResult = await api.turnStart(makeTurnParams(activeThreadId));
                      return {
                        turnId: turnResult.turn.id,
                        value: turnResult,
                        callId: options?.callId,
                        platform: options?.platform,
                        sourceMessageId: options?.sourceMessageId,
                      };
                    }
                  );
                  turn = started.value;
                  return { threadId: activeThreadId, turnId: turn.turn.id, status: "started" };
                }
              }
              throw new OrchestratorError(
                ErrorCode.RESUME_NOT_SUPPORTED,
                `thread ${threadName} 无法恢复：当前后端会话存储中未找到 rollout；若刚调整过 CODEX_HOME/工作目录，请新建 thread`,
                { threadId: activeThreadId, threadName }
              );
            }
            throw resumeError;
          }
          const resumedThreadId = resumed.thread.id;
          if (resumedThreadId !== activeThreadId) {
            log.warn({ old: activeThreadId, new: resumedThreadId }, "resume returned different ID, re-binding");
            activeThreadId = resumedThreadId;
            throw new OrchestratorError(
              ErrorCode.RESUME_NOT_SUPPORTED,
              `thread resume returned a new thread id for ${threadName}; refusing to mutate ThreadRecord identity`
            );
          }
          const started = await this.runTurnWithLifecycle(
            { ...turnRouteBase, threadId: activeThreadId },
            async () => {
              const turnResult = await api.turnStart(makeTurnParams(activeThreadId));
              return {
                turnId: turnResult.turn.id,
                value: turnResult,
                callId: options?.callId,
                platform: options?.platform,
                sourceMessageId: options?.sourceMessageId,
              };
            }
          );
          turn = started.value;
        } else {
          throw error;
        }
      }
      return { threadId: activeThreadId, turnId: turn.turn.id, status: "started" };
    } catch (error) {
      this.sessionStateService.releaseFailedStartTurn(key);
      throw error;
    }
  }

  async finishTurn(projectId: string, _threadId: string, options?: { threadName?: string }): Promise<TurnDiffResult | null> {
    if (!options?.threadName) {
      throw new Error(`finishTurn requires threadName: projectId=${projectId} threadId=${_threadId}`);
    }
    const resolvedProjectId = this.requireProjectId(projectId);
    const key = projectThreadKey(resolvedProjectId, options.threadName);
    this.sessionStateService.finishSessionTurn(key);
    const turn = await this.turnQueryService.getActiveTurnRecord(resolvedProjectId, options.threadName);
    if (!turn) {
      const runtimeState = await this.threadService.getRuntimeState(resolvedProjectId, options.threadName);
      log.warn({
        projectId: resolvedProjectId,
        threadId: _threadId,
        threadName: options.threadName,
        activeTurnId: runtimeState?.activeTurnId,
      }, "finishTurn: active turn missing");
      return null;
    }
    const turnId = turn.turnId;
    const worktreePath = turn.cwd;
    const traceId = turn.traceId;
    const diff = await this.gitOps.commit.commitAndDiff(
      worktreePath,
      `[codex] turn ${turnId} changes`,
      {
        projectId: resolvedProjectId,
        threadId: _threadId,
        threadName: options.threadName,
        turnId,
        traceId
      }
    );
    if (diff) {
      log.info({ projectId: resolvedProjectId, threadId: _threadId, threadName: options.threadName, turnId, traceId, files: diff.filesChanged.length }, "finishTurn: committed with diff");
      // Mark thread as diverged so stale detection knows it needs manual sync
      try {
        this.threadRegistry.update?.(resolvedProjectId, options.threadName, { hasDiverged: true });
      } catch (err) {
        log.warn({ projectId: resolvedProjectId, threadName: options.threadName, err: err instanceof Error ? err.message : String(err) }, "finishTurn: hasDiverged update failed (non-critical)");
      }
    }
    await this.turnCommandService.completeActiveTurn(resolvedProjectId, options.threadName, diff);
    return diff;
  }

  async handleTurnInterrupt(projectId: string, userId?: string): Promise<{ interrupted: boolean }> {
    const threadName = await this.resolveThreadName(projectId, userId);
    if (!threadName) return { interrupted: false };
    const resolvedProjectId = this.requireProjectId(projectId);
    const key = projectThreadKey(resolvedProjectId, threadName);
    const activeTurnId = await this.threadService.getActiveTurnId(resolvedProjectId, threadName);
    const result = await this.turnCommandService.interruptTurn(resolvedProjectId, userId);
    const machine = this.sessionStateService.getStateMachine(key);
    if (result.interrupted && activeTurnId && (machine.getState() === "RUNNING" || machine.getState() === "AWAITING_APPROVAL")) {
      this.sessionStateService.beginInterrupt(key, activeTurnId);
      const approvalIds = this.sessionStateService.turnState.clearPendingApprovalsForTurn(key, activeTurnId);
      const waitManager = this.sessionStateService.getApprovalWaitManager(key);
      for (const approvalId of approvalIds) {
        waitManager.clear(approvalId);
      }
      const threadRecord = this.threadService.getRecord(resolvedProjectId, threadName);
      if (threadRecord?.threadId) {
        this.eventPipeline?.markTurnInterrupting({
          projectId: resolvedProjectId,
          threadName,
          threadId: threadRecord.threadId,
          turnId: activeTurnId,
        });
      }
    }
    return result;
  }

  async handleRollback(projectId: string, userId?: string, options?: { threadName?: string }): Promise<{ rolledBack: boolean }> {
    const threadName = options?.threadName ?? await this.resolveThreadName(projectId, userId);
    if (!threadName) return { rolledBack: false };
    const resolvedProjectId = this.requireProjectId(projectId);
    const turnId = await this.threadService.getLastCompletedTurnId(resolvedProjectId, threadName);
    if (!turnId) return { rolledBack: false };
    return this.turnCommandService.revertTurn(resolvedProjectId, turnId);
  }

  async handleTurnAborted(projectId: string, threadName: string, turnId: string): Promise<void> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const key = projectThreadKey(resolvedProjectId, threadName);
    const approvalIds = this.sessionStateService.turnState.clearPendingApprovalsForTurn(key, turnId);
    const waitManager = this.sessionStateService.getApprovalWaitManager(key);
    for (const approvalId of approvalIds) {
      waitManager.clear(approvalId);
    }
    this.sessionStateService.completeInterrupt(key, turnId);
  }

  /* ── pipeline helpers ── */

  getPipelineApi(route: ThreadRouteBinding): AgentApi {
    const api = this.threadRuntimeService.getApi(route.projectId, route.threadName);
    if (!api) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `pipeline agent api not found: projectId=${route.projectId} threadName=${route.threadName}`
      );
    }
    if (!api.onNotification) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `pipeline agent api.onNotification is missing: projectId=${route.projectId} threadName=${route.threadName}`
      );
    }
    return api;
  }

  prepareTurnPipeline(route: ThreadRouteBinding): void {
    if (!this.eventPipeline) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
    }
    const api = this.getPipelineApi(route);
    this.eventPipeline.attachSource(api as Parameters<typeof this.eventPipeline.attachSource>[0], route);
    this.eventPipeline.prepareTurn(route);
  }

  activateTurnPipeline(route: RouteBinding): void {
    if (!this.eventPipeline) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, "eventPipeline is not configured");
    }
    const api = this.getPipelineApi(route);
    this.eventPipeline.attachSource(api as Parameters<typeof this.eventPipeline.attachSource>[0], route);
    this.eventPipeline.activateTurn(route);
  }

  /* ── private helpers ── */

  private async runTurnWithLifecycle<T>(
    route: ThreadRouteBinding,
    startTurn: () => Promise<{
      turnId: string;
      value: T;
      callId?: string;
      platform?: string;
      sourceMessageId?: string;
    }>
  ): Promise<{ turnId: string; value: T }> {
    this.prepareTurnPipeline(route);
    const started = await startTurn();
    await this.ensureTurnStarted({
      projectId: route.projectId,
      userId: route.userId,
      traceId: route.traceId,
      threadName: route.threadName,
      threadId: route.threadId,
      turnId: started.turnId,
      turnMode: route.turnMode,
      callId: started.callId,
      platform: started.platform,
      sourceMessageId: started.sourceMessageId,
    });
    this.activateTurnPipeline({ ...route, turnId: started.turnId });
    return started;
  }

  async ensureTurnStarted(input: TurnStartPersistenceInput): Promise<{ turnNumber: number }> {
    const resolvedProjectId = this.requireProjectId(input.projectId);
    const threadRecord = this.threadService.getRecord(resolvedProjectId, input.threadName);
    if (!threadRecord) {
      throw new OrchestratorError(
        ErrorCode.THREAD_NOT_FOUND,
        `thread record not found for ensureTurnStarted: projectId=${resolvedProjectId} threadName=${input.threadName}`
      );
    }

    const projectRuntime = await this.runtimeConfigProvider.getProjectRuntimeConfig(resolvedProjectId, input.userId);
    const isMergeResolver = parseMergeResolverName(input.threadName) !== null;
    const cwd = threadRecord.worktreePath ?? (!isMergeResolver && projectRuntime.cwd
      ? this.gitOps.worktree.getPath(projectRuntime.cwd, input.threadName)
      : "");
    if (!cwd) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        isMergeResolver
          ? `merge resolver thread is missing required worktreePath for ensureTurnStarted: projectId=${resolvedProjectId} threadName=${input.threadName}`
          : `turn cwd missing for ensureTurnStarted: projectId=${resolvedProjectId} threadName=${input.threadName}`
      );
    }
    try {
      await this.gitOps.accessCheck(cwd);
    } catch (error) {
      throw new OrchestratorError(
        ErrorCode.AGENT_API_UNAVAILABLE,
        `turn cwd is not accessible for ensureTurnStarted: projectId=${resolvedProjectId} threadName=${input.threadName} cwd=${cwd}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return this.turnCommandService.ensureTurnStarted({
      projectId: resolvedProjectId,
      threadName: input.threadName,
      threadId: input.threadId,
      turnId: input.turnId,
      callId: input.callId,
      platform: input.platform,
      sourceMessageId: input.sourceMessageId,
      cwd,
      userId: input.userId,
      traceId: input.traceId,
      promptSummary: input.promptSummary,
      backendName: threadRecord.backend.backendId,
      modelName: threadRecord.backend.model,
      turnMode: input.turnMode,
    });
  }

  private requireProjectId(projectId: string): string {
    const resolvedProjectId = this.projectResolver.findProjectById?.(projectId)?.id ?? null;
    if (!resolvedProjectId) {
      throw new OrchestratorError(ErrorCode.PROJECT_NOT_FOUND, `project not found: ${projectId}`);
    }
    return resolvedProjectId;
  }

  private async resolveThreadName(projectId: string, userId?: string): Promise<string | null> {
    if (!userId) return null;
    const binding = await this.threadService.getUserBinding(this.requireProjectId(projectId), userId);
    return binding?.threadName ?? null;
  }

  private async resolveAgentApi(projectId: string, threadName: string): Promise<AgentApi> {
    const resolvedProjectId = this.requireProjectId(projectId);
    const cached = this.threadRuntimeService.getApi(resolvedProjectId, threadName);
    if (cached) {
      await this.pluginService?.ensureProjectThreadSkills?.(resolvedProjectId, threadName);
      return cached;
    }
    const record = this.threadService.getRecord(resolvedProjectId, threadName);
    if (!record) {
      throw new OrchestratorError(ErrorCode.AGENT_API_UNAVAILABLE, `agent api unavailable for project-thread ${resolvedProjectId}/${threadName}`);
    }
    throw new OrchestratorError(
      ErrorCode.AGENT_API_UNAVAILABLE,
      `agent api unavailable for project-thread ${resolvedProjectId}/${threadName}: session not preloaded at startup`
    );
  }

  private async reinitializeEmptyCodexThread(params: {
    projectId: string;
    threadName: string;
    oldThreadId: string;
  }): Promise<{ threadId: string }> {
    const record = this.threadService.getRecord(params.projectId, params.threadName);
    if (!record) {
      throw new OrchestratorError(
        ErrorCode.THREAD_NOT_FOUND,
        `thread not found during empty-thread reinit: ${params.threadName}`
      );
    }
    const baseConfig = await this.threadRuntimeService.buildBaseThreadConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      backend: record.backend,
    });
    const config = await this.threadRuntimeService.prepareThreadRuntimeConfig({
      projectId: params.projectId,
      threadName: params.threadName,
      config: baseConfig,
      backendId: record.backend.backendId,
      ensureWorktree: false,
      existingWorktreePath: record.worktreePath,
    });
    const api = await this.resolveAgentApi(params.projectId, params.threadName);
    const created = await api.threadStart(config);
    await this.threadService.reinitializeEmptyThread({
      projectId: params.projectId,
      threadName: params.threadName,
      oldThreadId: params.oldThreadId,
      newThreadId: created.thread.id,
      backend: record.backend,
    });
    log.warn({
      projectId: params.projectId,
      threadName: params.threadName,
      oldThreadId: params.oldThreadId,
      newThreadId: created.thread.id,
    }, "reinitialized empty codex thread after missing rollout");
    return { threadId: created.thread.id };
  }
}
