import { TurnState } from "../turn/turn-state";
import { createLogger } from "../../packages/logger/src/index";
import type { TurnStateSnapshot } from "../turn/turn-state";
import type { IMOutputMessage } from "../event/im-output";
import { parseMergeResolverName } from "../merge/merge-naming";

import { AgentEventRouter } from "./router";
import type { UnifiedAgentEvent } from "../../packages/agent-core/src/index";
import { transformUnifiedAgentEvent } from "./transformer";
import { PlanTurnFinalizer } from "./plan-finalizer";
import { activeTurnKey, contextKey, threadKey, turnIdFromEvent } from "./pipeline-keys";
import { isCriticalMessage, isStreamingMessage } from "./message-classifier";
import { StreamOutputCoordinator } from "./stream-output-coordinator";
import type { NotificationSource, PipelineCallbacks, RouteBinding, ThreadRouteBinding } from "./pipeline-types";

type PipelineLane = "approval" | "stream";

interface QueuedEvent {
  lane: PipelineLane;
  route: ThreadRouteBinding;
  event: UnifiedAgentEvent;
  failureMessage: string;
}

interface TurnContextEntry {
  context: TurnState;
  createdAt: number;
}

const log = createLogger("orchestrator");

export class ThreadEventRuntime {
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
  private readonly laneQueues = new Map<string, QueuedEvent[]>();
  private readonly laneDraining = new Map<string, Promise<void>>();
  private readonly contextTtlMs: number;
  private readonly planFinalizer = new PlanTurnFinalizer();
  private readonly streamOutputCoordinator: StreamOutputCoordinator;

  constructor(
    private readonly projectId: string,
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
      routeMessage: async (projectId, message, options) => {
        await this.eventRouter.routeMessage(projectId, message, options);
      }
    }, options?.streamOutput);
  }

  private assertProject(routeProjectId: string): void {
    if (routeProjectId !== this.projectId) {
      throw new Error(`thread runtime project mismatch: expected=${this.projectId} actual=${routeProjectId}`);
    }
  }

  registerTurnCompleteHook(projectId: string, threadName: string, hook: (turnId: string) => Promise<void>): void {
    this.assertProject(projectId);
    this.turnCompleteHooks.set(`${projectId}:${threadName}`, hook);
  }

  unregisterTurnCompleteHook(projectId: string, threadName: string): void {
    this.assertProject(projectId);
    this.turnCompleteHooks.delete(`${projectId}:${threadName}`);
  }

  async routeMessage(projectId: string, message: IMOutputMessage): Promise<void> {
    this.assertProject(projectId);
    await this.eventRouter.routeMessage(projectId, message);
  }

  async waitForIdle(): Promise<void> {
    while (this.laneDraining.size > 0) {
      await Promise.all([...this.laneDraining.values()]);
    }
  }

  attachSource(source: NotificationSource, route: ThreadRouteBinding): void {
    this.assertProject(route.projectId);
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
      this.enqueueNotification(activeRoute, notification, "event pipeline notification handling failed");
    });
  }

  prepareTurn(route: ThreadRouteBinding): void {
    this.assertProject(route.projectId);
    this.pendingTurns.set(threadKey(route), route);
  }

  activateTurn(route: RouteBinding): void {
    this.assertProject(route.projectId);
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
        this.enqueueNotification(route, notification, "event pipeline queued notification handling failed");
      }
    }
  }

  markTurnInterrupting(route: RouteBinding): void {
    this.assertProject(route.projectId);
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
    this.assertProject(projectId);
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

  private laneForEvent(event: UnifiedAgentEvent): PipelineLane {
    return event.type === "approval_request" ? "approval" : "stream";
  }

  private resolveEventContext(route: ThreadRouteBinding, event: UnifiedAgentEvent): {
    turnRoute: RouteBinding | null;
    turnId: string;
  } | null {
    const turnRoute = this.resolveTurnRoute(route, event);
    const turnId = turnRoute?.turnId ?? turnIdFromEvent(event) ?? "";
    if (!turnRoute && !turnId) {
      return null;
    }
    return { turnRoute, turnId };
  }

  private isTerminalEvent(event: UnifiedAgentEvent): boolean {
    return event.type === "turn_aborted" || event.type === "turn_complete";
  }

  private isTurnSuppressed(route: ThreadRouteBinding, turnId: string, event: UnifiedAgentEvent): boolean {
    const incomingTurnId = turnIdFromEvent(event);
    const threadInterruptingTurnId = this.interruptingTurnByThread.get(threadKey(route));
    if (incomingTurnId && this.suppressedTurns.has(contextKey(route.projectId, incomingTurnId)) && !this.isTerminalEvent(event)) {
      return true;
    }
    if (!incomingTurnId && threadInterruptingTurnId) {
      return true;
    }
    if (threadInterruptingTurnId && incomingTurnId === threadInterruptingTurnId && !this.isTerminalEvent(event)) {
      return true;
    }
    return turnId.length > 0 && this.finishedTurns.has(`${route.projectId}:${turnId}`) && !this.isTerminalEvent(event);
  }

  private async handleApprovalNotification(route: ThreadRouteBinding, event: UnifiedAgentEvent): Promise<void> {
    if (event.type !== "approval_request") {
      throw new Error(`approval lane received unexpected event type: ${event.type}`);
    }
    const routeLog = log.child({
      projectId: route.projectId,
      traceId: route.traceId,
      userId: route.userId,
      threadName: route.threadName,
      threadId: route.threadId,
      lane: "approval"
    });
    this.pruneExpiredContexts(Date.now());

    const resolved = this.resolveEventContext(route, event);
    if (!resolved) {
      routeLog.debug({ eventType: event.type }, "approval lane dropped event without resolvable turn context");
      return;
    }
    const { turnRoute, turnId } = resolved;
    if (this.isTurnSuppressed(route, turnId, event)) {
      routeLog.debug({ turnId, eventType: event.type }, "approval lane dropped suppressed or finished event");
      return;
    }

    const approvalResult = await this.callbacks.registerApprovalRequest({
      projectId: route.projectId,
      userId: (turnRoute ?? route).userId,
      backendApprovalId: event.backendApprovalId ?? event.approvalId,
      threadId: (turnRoute ?? route).threadId,
      threadName: route.threadName,
      turnId,
      callId: event.callId,
      approvalType: event.approvalType,
      display: {
        threadName: route.threadName,
        displayName: event.displayName,
        summary: event.summary,
        reason: event.reason,
        cwd: event.cwd,
        description: event.description,
        files: event.files,
        createdAt: new Date().toISOString()
      }
    });
    if (!approvalResult.accepted) {
      routeLog.debug({ turnId, approvalId: approvalResult.approvalId }, "approval lane skipped UI routing for rejected registration");
      return;
    }

    const transformCtx = { projectId: route.projectId, threadId: (turnRoute ?? route).threadId, turnId, threadName: route.threadName };
    const message = transformUnifiedAgentEvent({
      ...event,
      approvalId: approvalResult.approvalId ?? event.approvalId
    }, transformCtx);
    if (!message) {
      return;
    }

    await this.eventRouter.routeMessage(route.projectId, message);
  }

  private async handleStreamNotification(route: ThreadRouteBinding, event: UnifiedAgentEvent): Promise<void> {
    const routeLog = log.child({
      projectId: route.projectId,
      traceId: route.traceId,
      userId: route.userId,
      threadName: route.threadName,
      threadId: route.threadId,
      lane: "stream"
    });
    this.pruneExpiredContexts(Date.now());

    const resolved = this.resolveEventContext(route, event);
    const turnId = resolved?.turnId ?? turnIdFromEvent(event) ?? "";
    if (turnId && this.isTurnSuppressed(route, turnId, event)) {
      return;
    }
    const turnRoute = resolved?.turnRoute ?? null;
    if (!turnRoute && !turnId) {
      routeLog.debug({ eventType: event.type }, "event pipeline dropped event without resolvable turn context");
      return;
    }

    const transformCtx = { projectId: route.projectId, threadId: (turnRoute ?? route).threadId, turnId, threadName: route.threadName };
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
      } else if (isCriticalMessage(message)) {
        await this.streamOutputCoordinator.flushForCriticalMessage(route.projectId, route.threadName, turnId, message.kind);
        routeLog.debug({ turnId, messageKind: message.kind }, "critical message passthrough");
        await this.callbacks.syncTurnState?.(route.projectId, turnId, snapshot);
        await this.eventRouter.routeMessage(route.projectId, message);
      } else {
        this.streamOutputCoordinator.markSnapshotDirty(route.projectId, turnId, snapshot);
        await this.eventRouter.routeMessage(route.projectId, message);
      }
    }

    if (event.type === "turn_complete") {
      // If this turn is being interrupted, treat turn_complete as turn_aborted
      // to ensure completeInterrupt() fires and the INTERRUPTING state is released.
      const tKey = threadKey(route);
      if (this.interruptingTurnByThread.get(tKey) === turnId) {
        routeLog.info({ turnId, threadName: route.threadName }, "turn_complete for interrupting turn — redirecting to abort path");
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
        this.interruptingTurnByThread.delete(tKey);
        this.suppressedTurns.add(contextKey(route.projectId, turnId));
        setTimeout(() => this.suppressedTurns.delete(contextKey(route.projectId, turnId)), this.contextTtlMs);
        this.streamOutputCoordinator.cleanup(route.projectId, turnId);
        this.planFinalizer.unregister(route.projectId, turnId);

        if (turnRoute) {
          this.activeTurns.delete(activeTurnKey(turnRoute, turnId));
          if (this.latestTurnByThread.get(tKey) === turnId) {
            this.latestTurnByThread.delete(tKey);
          }
        }
        return;
      }

      const dedupKey = `${route.projectId}:${turnId}`;
      if (this.finishedTurns.has(dedupKey)) {
        return;
      }
      this.finishedTurns.add(dedupKey);
      this.ensuredTurns.delete(dedupKey);
      setTimeout(() => this.finishedTurns.delete(dedupKey), this.contextTtlMs);

      const diff = await this.callbacks.finishTurn(route.projectId, (turnRoute ?? route).threadId, {
        threadName: route.threadName
      });

      const key = contextKey(route.projectId, turnId);
      const turnContext = this.contexts.get(key);
      await this.streamOutputCoordinator.forceFlush(route.projectId, route.threadName, turnId, "turn_complete");

      const finalizedPlan = this.planFinalizer.finalize(route.projectId, turnId);
      if (finalizedPlan.error) {
        routeLog.warn({ turnId, threadName: route.threadName }, finalizedPlan.error);
      }
      if (finalizedPlan.message) {
        turnContext?.context.applyOutputMessage(finalizedPlan.message);
        await this.eventRouter.routeMessage(route.projectId, finalizedPlan.message);
      }

      if (turnContext) {
        const summary = turnContext.context.toSummary();
        summary.isMergeResolver = parseMergeResolverName(route.threadName) !== null;
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
        const tKey2 = threadKey(turnRoute);
        if (this.latestTurnByThread.get(tKey2) === turnId) {
          this.latestTurnByThread.delete(tKey2);
        }
      }

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

  private enqueueNotification(route: ThreadRouteBinding, event: UnifiedAgentEvent, failureMessage: string): void {
    this.enqueueLaneNotification(this.laneForEvent(event), route, event, failureMessage);
  }

  private enqueueLaneNotification(
    lane: PipelineLane,
    route: ThreadRouteBinding,
    event: UnifiedAgentEvent,
    failureMessage: string
  ): void {
    const key = `${lane}:${threadKey(route)}`;
    const queue = this.laneQueues.get(key) ?? [];
    queue.push({ lane, route, event, failureMessage });
    this.laneQueues.set(key, queue);
    if (!this.laneDraining.has(key)) {
      this.startDrain(key);
    }
  }

  private startDrain(key: string): void {
    const drain = new Promise<void>((resolve) => {
      const processNext = (): void => {
        const queue = this.laneQueues.get(key);
        const item = queue?.shift();
        if (!item) {
          this.laneQueues.delete(key);
          this.laneDraining.delete(key);
          resolve();
          return;
        }
        const handler = item.lane === "approval"
          ? this.handleApprovalNotification(item.route, item.event)
          : this.handleStreamNotification(item.route, item.event);
        handler
          .catch((error) => {
            log.warn({
              projectId: item.route.projectId,
              threadName: item.route.threadName,
              threadId: item.route.threadId,
              lane: item.lane,
              err: error instanceof Error ? error.message : String(error)
            }, item.failureMessage);
          })
          .finally(() => {
            setImmediate(processNext);
          });
      };
      processNext();
    });
    this.laneDraining.set(key, drain);
  }
}

