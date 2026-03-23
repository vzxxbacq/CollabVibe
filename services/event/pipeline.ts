import { TurnState } from "../turn/turn-state";
import { createLogger } from "../../packages/logger/src/index";
import type { TurnStateSnapshot } from "../turn/turn-state";
import type { IMOutputMessage } from "../event/im-output";
import type { TurnDiffResult } from "../../packages/git-utils/src/index";
import { parseMergeResolverName } from "../merge/merge-naming";

import { AgentEventRouter } from "./router";
import type { UnifiedAgentEvent } from "../../packages/agent-core/src/index";
import { transformUnifiedAgentEvent } from "./transformer";
import { PlanTurnFinalizer } from "./plan-finalizer";
import { activeTurnKey, contextKey, threadKey, turnIdFromEvent } from "./pipeline-keys";
import { isCriticalMessage, isStreamingMessage } from "./message-classifier";
import { StreamOutputCoordinator } from "./stream-output-coordinator";

interface NotificationSource {
  onNotification(handler: (event: UnifiedAgentEvent) => void): void;
}

export interface ThreadRouteBinding {
  projectId: string;
  userId?: string;
  traceId?: string;
  threadName: string;
  threadId: string;
  cwd?: string;
  turnMode?: "plan";
}

export interface RouteBinding extends ThreadRouteBinding {
  turnId: string;
}

/**
 * Callbacks that decouple the pipeline from the orchestrator.
 * Any module (orchestrator, test harness, etc.) can provide these.
 */
export interface PipelineCallbacks {
  registerApprovalRequest(params: {
    projectId: string;
    userId?: string;
    approvalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
  }): { accepted: boolean };
  /**
   * Finish a turn: auto-commit worktree changes and compute diff.
   * Returns the diff result (or null if no changes).
   */
  finishTurn(projectId: string, threadId: string, options?: { threadName?: string }): Promise<TurnDiffResult | null>;
  ensureTurnStarted?(params: {
    projectId: string;
    userId?: string;
    traceId?: string;
    threadName: string;
    threadId: string;
    turnId: string;
    turnMode?: "plan";
    promptSummary?: string;
  }): Promise<{ turnNumber: number }>;
  syncTurnState?(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
  finalizeTurnState?(projectId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
  onTurnAborted?(params: {
    projectId: string;
    threadName: string;
    turnId: string;
  }): Promise<void>;
}

interface TurnContextEntry {
  context: TurnState;
  createdAt: number;
}

const log = createLogger("orchestrator");

export class EventPipeline {
  private readonly contexts = new Map<string, TurnContextEntry>();
  private readonly sourceRoutes = new WeakMap<NotificationSource, ThreadRouteBinding>();
  private readonly pendingEventQueues = new Map<string, UnifiedAgentEvent[]>();
  private readonly pendingTurns = new Map<string, ThreadRouteBinding>();
  private readonly activeTurns = new Map<string, RouteBinding>();
  private readonly latestTurnByThread = new Map<string, string>();
  private readonly attachedSources = new WeakSet<NotificationSource>();
  private readonly finishedTurns = new Set<string>();
  private readonly suppressedTurns = new Set<string>();
  private readonly interruptingTurnByThread = new Map<string, string>();
  private readonly ensuredTurns = new Set<string>();
  private readonly turnCompleteHooks = new Map<string, (turnId: string) => Promise<void>>();
  private readonly contextTtlMs: number;
  private readonly planFinalizer = new PlanTurnFinalizer();
  private readonly streamOutputCoordinator: StreamOutputCoordinator;

  constructor(
    private readonly eventRouter: AgentEventRouter,
    private readonly callbacks: PipelineCallbacks,
    options?: {
      contextTtlMs?: number;
      streamOutput?: {
        persistWindowMs?: number;
        persistMaxWaitMs?: number;
        persistMaxChars?: number;
        uiWindowMs?: number;
        uiMaxWaitMs?: number;
        uiMaxChars?: number;
      };
    }
  ) {
    this.contextTtlMs = options?.contextTtlMs ?? 10 * 60 * 1000;
    this.streamOutputCoordinator = new StreamOutputCoordinator({
      syncTurnState: async (projectId, turnId, snapshot) => {
        await this.callbacks.syncTurnState?.(projectId, turnId, snapshot);
      },
      routeMessage: async (projectId, message) => {
        await this.eventRouter.routeMessage(projectId, message);
      }
    }, options?.streamOutput);
  }

  /** Register a one-shot hook to execute after a turn completes for a specific thread. */
  registerTurnCompleteHook(projectId: string, threadName: string, hook: (turnId: string) => Promise<void>): void {
    this.turnCompleteHooks.set(`${projectId}:${threadName}`, hook);
  }

  /** Remove a registered turn-complete hook. */
  unregisterTurnCompleteHook(projectId: string, threadName: string): void {
    this.turnCompleteHooks.delete(`${projectId}:${threadName}`);
  }

  /** Public: route an output message through the event router (Path B convergence). */
  async routeMessage(projectId: string, message: IMOutputMessage): Promise<void> {
    await this.eventRouter.routeMessage(projectId, message);
  }

  attachSource(source: NotificationSource, route: ThreadRouteBinding): void {
    this.sourceRoutes.set(source, route);

    if (this.attachedSources.has(source)) {
      return;
    }

    this.attachedSources.add(source);
    source.onNotification((notification) => {
      const activeRoute = this.sourceRoutes.get(source);
      if (!activeRoute) {
        return;
      }
      const pendingKey = threadKey(activeRoute);
      if (this.pendingTurns.has(pendingKey) && !this.latestTurnByThread.has(pendingKey)) {
        const queued = this.pendingEventQueues.get(pendingKey) ?? [];
        queued.push(notification);
        this.pendingEventQueues.set(pendingKey, queued);
        return;
      }
      this.handleNotification(activeRoute, notification).catch((error) => {
        log.warn({
          projectId: activeRoute.projectId,
          threadName: activeRoute.threadName,
          threadId: activeRoute.threadId,
          err: error instanceof Error ? error.message : String(error)
        }, "event pipeline notification handling failed");
      });
    });
  }

  prepareTurn(route: ThreadRouteBinding): void {
    this.pendingTurns.set(threadKey(route), route);
  }

  activateTurn(route: RouteBinding): void {
    this.activeTurns.set(activeTurnKey(route, route.turnId), route);
    this.latestTurnByThread.set(threadKey(route), route.turnId);
    this.pendingTurns.delete(threadKey(route));
    this.planFinalizer.registerRoute(route);
    this.eventRouter.registerRoute(route.projectId, {
      projectId: route.projectId,
      threadName: route.threadName,
      threadId: route.threadId,
      turnId: route.turnId
    });
    const queued = this.pendingEventQueues.get(threadKey(route));
    if (queued?.length) {
      this.pendingEventQueues.delete(threadKey(route));
      for (const notification of queued) {
        this.handleNotification(route, notification).catch((error) => {
          log.warn({
            projectId: route.projectId,
            threadName: route.threadName,
            threadId: route.threadId,
            err: error instanceof Error ? error.message : String(error)
          }, "event pipeline queued notification handling failed");
        });
      }
    }
  }

  markTurnInterrupting(route: RouteBinding): void {
    const turnKey = contextKey(route.projectId, route.turnId);
    this.suppressedTurns.add(turnKey);
    this.interruptingTurnByThread.set(threadKey(route), route.turnId);
  }

  async updateTurnMetadata(projectId: string, turnId: string, metadata: {
    promptSummary?: string;
    backendName?: string;
    modelName?: string;
    turnMode?: "plan";
  }): Promise<boolean> {
    const key = contextKey(projectId, turnId);
    const entry = this.contexts.get(key);
    if (!entry) {
      return false;
    }
    entry.context.applyMetadata(metadata);
    await this.callbacks.syncTurnState?.(projectId, turnId, entry.context.snapshot());
    return true;
  }

  private getTurnContext(route: ThreadRouteBinding, turnId: string): TurnState {
    const key = contextKey(route.projectId, turnId);
    const existing = this.contexts.get(key);
    if (existing) {
      return existing.context;
    }
    const created = new TurnState(route.threadId, turnId, route.threadName);
    this.contexts.set(key, { context: created, createdAt: Date.now() });
    return created;
  }

  private pruneExpiredContexts(now: number): void {
    for (const [key, entry] of this.contexts.entries()) {
      if (now - entry.createdAt >= this.contextTtlMs) {
        this.contexts.delete(key);
      }
    }
  }

  private resolveTurnRoute(sourceRoute: ThreadRouteBinding, event: UnifiedAgentEvent): RouteBinding | null {
    const tKey = threadKey(sourceRoute);
    const eventTurnId = turnIdFromEvent(event);
    if (eventTurnId) {
      const existing = this.activeTurns.get(activeTurnKey(sourceRoute, eventTurnId));
      if (existing) {
        return existing;
      }
      const pending = this.pendingTurns.get(tKey);
      const activated: RouteBinding = {
        ...(pending ?? sourceRoute),
        turnId: eventTurnId
      };
      this.activateTurn(activated);
      return activated;
    }

    const latestTurnId = this.latestTurnByThread.get(tKey);
    if (!latestTurnId) {
      return null;
    }
    return this.activeTurns.get(activeTurnKey(sourceRoute, latestTurnId)) ?? null;
  }

  private async handleNotification(route: ThreadRouteBinding, event: UnifiedAgentEvent): Promise<void> {
    const routeLog = log.child({
      projectId: route.projectId,
      traceId: route.traceId,
      userId: route.userId,
      threadName: route.threadName,
      threadId: route.threadId
    });
    this.pruneExpiredContexts(Date.now());

    const incomingTurnId = turnIdFromEvent(event);
    const threadInterruptingTurnId = this.interruptingTurnByThread.get(threadKey(route));
    if (incomingTurnId && this.suppressedTurns.has(contextKey(route.projectId, incomingTurnId)) && event.type !== "turn_aborted") {
      return;
    }
    if (!incomingTurnId && threadInterruptingTurnId) {
      return;
    }
    if (threadInterruptingTurnId && incomingTurnId === threadInterruptingTurnId && event.type !== "turn_aborted") {
      return;
    }

    const turnRoute = this.resolveTurnRoute(route, event);
    const turnId = turnRoute?.turnId ?? turnIdFromEvent(event) ?? "";
    if (!turnRoute && !turnId) {
      routeLog.debug({ eventType: event.type }, "event pipeline dropped event without resolvable turn context");
      return;
    }

    const callbackContext = { traceId: (turnRoute ?? route).traceId, threadId: (turnRoute ?? route).threadId, turnId, userId: (turnRoute ?? route).userId };
    const transformCtx = { projectId: route.projectId, threadId: (turnRoute ?? route).threadId, turnId, threadName: route.threadName };
    let shouldRouteToUi = true;
    if (event.type === "approval_request") {
      const approvalResult = this.callbacks.registerApprovalRequest({
        projectId: route.projectId,
        userId: (turnRoute ?? route).userId,
        approvalId: event.approvalId,
        threadId: (turnRoute ?? route).threadId,
        threadName: route.threadName,
        turnId,
        callId: event.callId,
        approvalType: event.approvalType
      });
      shouldRouteToUi = approvalResult.accepted;
    }

    const message = transformUnifiedAgentEvent(event, transformCtx);

    if (turnId && this.callbacks.ensureTurnStarted) {
      const ensureKey = `${route.projectId}:${turnId}`;
      if (!this.ensuredTurns.has(ensureKey)) {
        this.ensuredTurns.add(ensureKey);
        try {
          await this.callbacks.ensureTurnStarted({
            projectId: route.projectId,
            userId: (turnRoute ?? route).userId,
            traceId: (turnRoute ?? route).traceId,
            threadName: route.threadName,
            threadId: (turnRoute ?? route).threadId,
            turnId,
            turnMode: route.turnMode,
          });
        } catch (error) {
          this.ensuredTurns.delete(ensureKey);
          throw error;
        }
      }
    }

    if (message) {
      this.planFinalizer.ingestMessage(route.projectId, message);
      const turnContext = this.getTurnContext(turnRoute ?? route, turnId);
      turnContext.applyOutputMessage(message);
      const snapshot = turnContext.snapshot();

      if (isStreamingMessage(message)) {
        await this.streamOutputCoordinator.ingest(route.projectId, route.threadName, turnId, snapshot, message);
      } else {
        if (isCriticalMessage(message)) {
          await this.streamOutputCoordinator.flushForCriticalMessage(route.projectId, route.threadName, turnId, message.kind);
          routeLog.debug({ turnId, messageKind: message.kind }, "critical message passthrough");
        }
        await this.callbacks.syncTurnState?.(route.projectId, turnId, snapshot);
        if (shouldRouteToUi) {
          await this.eventRouter.routeMessage(route.projectId, message);
        }
      }
    }

    if (event.type === "turn_complete") {
      // Dedup: backend may send both turn_complete and turn_aborted for the same turn
      const dedupKey = `${route.projectId}:${turnId}`;
      if (this.finishedTurns.has(dedupKey)) {
        return;
      }
      this.finishedTurns.add(dedupKey);
      this.ensuredTurns.delete(dedupKey);
      // Auto-cleanup after TTL to avoid unbounded growth
      setTimeout(() => this.finishedTurns.delete(dedupKey), this.contextTtlMs);

      // Compute diff from git worktree (single source of truth) + auto-commit
      const diff = await this.callbacks.finishTurn(route.projectId, (turnRoute ?? route).threadId, {
        threadName: route.threadName
      });

      // Build turn context early so we can apply finalizedPlan before snapshot
      const key = contextKey(route.projectId, turnId);
      const turnContext = this.contexts.get(key);
      await this.streamOutputCoordinator.forceFlush(route.projectId, route.threadName, turnId, "turn_complete");

      const finalizedPlan = this.planFinalizer.finalize(route.projectId, turnId);
      if (finalizedPlan.error) {
        routeLog.warn({ turnId, threadName: route.threadName }, finalizedPlan.error);
      }
      if (finalizedPlan.message) {
        // Write finalized plan back to turnContext BEFORE finalizeTurnState() takes its snapshot,
        // so TurnDetailRecord.planState contains the structured plan for historical card recovery.
        turnContext?.context.applyOutputMessage(finalizedPlan.message);
        await this.eventRouter.routeMessage(route.projectId, finalizedPlan.message);
      }

      // Build turn summary with diff data from git
      if (turnContext) {
        const summary = turnContext.context.toSummary();
        summary.isMergeResolver = parseMergeResolverName(route.threadName) !== null;
        // Merge diff result into summary
        if (diff) {
          summary.filesChanged = diff.filesChanged;
          summary.fileChangeDetails = [{
            diffSummary: diff.diffSummary,
            filesChanged: diff.filesChanged,
            stats: diff.stats,
            diffFiles: diff.diffFiles,
            diffSegments: diff.diffSegments,
          }];
        }
        turnContext.context.applyTurnSummary(summary);
        await this.callbacks.finalizeTurnState?.(route.projectId, turnId, turnContext.context.snapshot());
        await this.eventRouter.routeMessage(route.projectId, summary);
        this.contexts.delete(key);
      }
      this.streamOutputCoordinator.cleanup(route.projectId, turnId);
      this.planFinalizer.unregister(route.projectId, turnId);

      if (turnRoute) {
        this.activeTurns.delete(activeTurnKey(turnRoute, turnId));
        const tKey = threadKey(turnRoute);
        if (this.latestTurnByThread.get(tKey) === turnId) {
          this.latestTurnByThread.delete(tKey);
        }
      }

      // Execute registered turn-complete hooks (e.g., merge resolver post-turn logic)
      const hookKey = `${route.projectId}:${route.threadName}`;
      const hook = this.turnCompleteHooks.get(hookKey);
      if (hook) {
        this.turnCompleteHooks.delete(hookKey);
        try {
          await hook(turnId);
        } catch (hookErr) {
          routeLog.warn({ turnId, threadName: route.threadName, err: hookErr instanceof Error ? hookErr.message : String(hookErr) }, "turn-complete hook failed");
        }
      }
    }

    if (event.type === "turn_aborted") {
      const dedupKey = `${route.projectId}:${turnId}`;
      if (this.finishedTurns.has(dedupKey)) {
        return;
      }
      this.finishedTurns.add(dedupKey);
      this.ensuredTurns.delete(dedupKey);
      setTimeout(() => this.finishedTurns.delete(dedupKey), this.contextTtlMs);

      const key = contextKey(route.projectId, turnId);
      const turnContext = this.contexts.get(key);
      await this.streamOutputCoordinator.forceFlush(route.projectId, route.threadName, turnId, "turn_aborted");
      const finalizedPlan = this.planFinalizer.finalize(route.projectId, turnId);
      if (finalizedPlan.error) {
        routeLog.warn({ turnId, threadName: route.threadName }, finalizedPlan.error);
      }
      if (finalizedPlan.message) {
        turnContext?.context.applyOutputMessage(finalizedPlan.message);
        await this.eventRouter.routeMessage(route.projectId, finalizedPlan.message);
      }
      if (turnContext) {
        await this.callbacks.finalizeTurnState?.(route.projectId, turnId, turnContext.context.snapshot());
        this.contexts.delete(key);
      }
      await this.callbacks.onTurnAborted?.({
        projectId: route.projectId,
        threadName: route.threadName,
        turnId,
      });
      this.interruptingTurnByThread.delete(threadKey(route));
      this.suppressedTurns.add(contextKey(route.projectId, turnId));
      setTimeout(() => this.suppressedTurns.delete(contextKey(route.projectId, turnId)), this.contextTtlMs);
      this.streamOutputCoordinator.cleanup(route.projectId, turnId);
      this.planFinalizer.unregister(route.projectId, turnId);

      if (turnRoute) {
        this.activeTurns.delete(activeTurnKey(turnRoute, turnId));
        const tKey = threadKey(turnRoute);
        if (this.latestTurnByThread.get(tKey) === turnId) {
          this.latestTurnByThread.delete(tKey);
        }
      }
    }
  }
}
