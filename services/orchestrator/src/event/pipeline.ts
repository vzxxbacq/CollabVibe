import { TurnState } from "../../../contracts/im/turn-state";
import { createLogger } from "../../../../packages/logger/src/index";
import type { TurnStateSnapshot } from "../../../contracts/im/turn-state";
import type { IMOutputMessage } from "../../../contracts/im/im-output";
import type { CodexNotification } from "../../../../packages/agent-core/src/transports/codex/index";
import type { TurnDiffResult } from "../../../../packages/git-utils/src/commit";

import { AgentEventRouter } from "./router";
import { codexEventToUnifiedAgentEvent } from "../../../../packages/agent-core/src/transports/codex/codex-event-bridge";
import type { UnifiedAgentEvent } from "../../../../packages/agent-core/src/unified-agent-event";
import { transformUnifiedAgentEvent } from "./transformer";
import { PlanTurnFinalizer } from "./plan-finalizer";

interface NotificationSource {
  onNotification(handler: (notification: CodexNotification | UnifiedAgentEvent) => void): void;
}

export interface ThreadRouteBinding {
  chatId: string;
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
    chatId: string;
    userId?: string;
    approvalId: string;
    threadId: string;
    threadName: string;
    turnId: string;
    callId: string;
    approvalType: "command_exec" | "file_change";
  }): void;
  /**
   * Finish a turn: auto-commit worktree changes and compute diff.
   * Returns the diff result (or null if no changes).
   */
  finishTurn(chatId: string, threadId: string, options?: { threadName?: string }): Promise<TurnDiffResult | null>;
  syncTurnState?(chatId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
  finalizeTurnState?(chatId: string, turnId: string, snapshot: TurnStateSnapshot): Promise<void>;
}

interface TurnContextEntry {
  context: TurnState;
  createdAt: number;
}

function contextKey(chatId: string, turnId: string): string {
  return `${chatId}:${turnId}`;
}

function threadKey(route: ThreadRouteBinding): string {
  return `${route.chatId}:${route.threadName}`;
}

function activeTurnKey(route: ThreadRouteBinding, turnId: string): string {
  return `${threadKey(route)}:${turnId}`;
}

function turnIdFromEvent(event: UnifiedAgentEvent): string | null {
  return event.turnId && event.turnId.length > 0 ? event.turnId : null;
}

function toUnified(notification: CodexNotification | UnifiedAgentEvent): UnifiedAgentEvent | null {
  if (typeof (notification as UnifiedAgentEvent).type === "string" && !("method" in (notification as Record<string, unknown>))) {
    return notification as UnifiedAgentEvent;
  }
  return codexEventToUnifiedAgentEvent(notification as CodexNotification);
}

const log = createLogger("orchestrator");

export class EventPipeline {
  private readonly contexts = new Map<string, TurnContextEntry>();
  private readonly sourceRoutes = new WeakMap<NotificationSource, ThreadRouteBinding>();
  private readonly pendingTurns = new Map<string, ThreadRouteBinding>();
  private readonly activeTurns = new Map<string, RouteBinding>();
  private readonly latestTurnByThread = new Map<string, string>();
  private readonly attachedSources = new WeakSet<NotificationSource>();
  private readonly finishedTurns = new Set<string>();
  private readonly contextTtlMs: number;
  private readonly planFinalizer = new PlanTurnFinalizer();

  constructor(
    private readonly eventRouter: AgentEventRouter,
    private readonly callbacks: PipelineCallbacks,
    options?: { contextTtlMs?: number }
  ) {
    this.contextTtlMs = options?.contextTtlMs ?? 10 * 60 * 1000;
  }

  /** Public: route an output message through the event router (Path B convergence). */
  async routeMessage(chatId: string, message: IMOutputMessage): Promise<void> {
    await this.eventRouter.routeMessage(chatId, message);
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
      this.handleNotification(activeRoute, notification).catch((error) => {
        log.warn({
          chatId: activeRoute.chatId,
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
    this.eventRouter.registerRoute(route.chatId, {
      chatId: route.chatId,
      threadName: route.threadName,
      threadId: route.threadId,
      turnId: route.turnId
    });
  }

  async updateTurnMetadata(chatId: string, turnId: string, metadata: {
    promptSummary?: string;
    backendName?: string;
    modelName?: string;
    turnMode?: "plan";
  }): Promise<boolean> {
    const key = contextKey(chatId, turnId);
    const entry = this.contexts.get(key);
    if (!entry) {
      return false;
    }
    entry.context.applyMetadata(metadata);
    await this.callbacks.syncTurnState?.(chatId, turnId, entry.context.snapshot());
    return true;
  }

  private getTurnContext(route: ThreadRouteBinding, turnId: string): TurnState {
    const key = contextKey(route.chatId, turnId);
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

  private async handleNotification(route: ThreadRouteBinding, notification: CodexNotification | UnifiedAgentEvent): Promise<void> {
    const routeLog = log.child({
      chatId: route.chatId,
      traceId: route.traceId,
      userId: route.userId,
      threadName: route.threadName,
      threadId: route.threadId
    });
    this.pruneExpiredContexts(Date.now());
    const event = toUnified(notification);
    if (!event) {
      routeLog.debug("event pipeline dropped non-unified notification");
      return;
    }

    const turnRoute = this.resolveTurnRoute(route, event);
    const turnId = turnRoute?.turnId ?? turnIdFromEvent(event) ?? "";
    if (!turnRoute && !turnId) {
      routeLog.debug({ eventType: event.type }, "event pipeline dropped event without resolvable turn context");
      return;
    }

    const callbackContext = { traceId: (turnRoute ?? route).traceId, threadId: (turnRoute ?? route).threadId, turnId, userId: (turnRoute ?? route).userId };
    const transformCtx = { chatId: route.chatId, threadId: (turnRoute ?? route).threadId, turnId, threadName: route.threadName };
    const message = transformUnifiedAgentEvent(event, transformCtx);

    const shouldRouteToUi = true;
    if (message) {
      this.planFinalizer.ingestMessage(route.chatId, message);
      const turnContext = this.getTurnContext(turnRoute ?? route, turnId);
      turnContext.applyOutputMessage(message);
      await this.callbacks.syncTurnState?.(route.chatId, turnId, turnContext.snapshot());
      if (shouldRouteToUi) {
        await this.eventRouter.routeMessage(route.chatId, message);
      }
    }

    if (event.type === "approval_request") {
      this.callbacks.registerApprovalRequest({
        chatId: route.chatId,
        userId: (turnRoute ?? route).userId,
        approvalId: event.approvalId,
        threadId: (turnRoute ?? route).threadId,
        threadName: route.threadName,
        turnId,
        callId: event.callId,
        approvalType: event.approvalType
      });
    }

    if (event.type === "turn_complete" || event.type === "turn_aborted") {
      // Dedup: backend may send both turn_complete and turn_aborted for the same turn
      const dedupKey = `${route.chatId}:${turnId}`;
      if (this.finishedTurns.has(dedupKey)) {
        return;
      }
      this.finishedTurns.add(dedupKey);
      // Auto-cleanup after TTL to avoid unbounded growth
      setTimeout(() => this.finishedTurns.delete(dedupKey), this.contextTtlMs);

      // Compute diff from git worktree (single source of truth) + auto-commit
      const diff = await this.callbacks.finishTurn(route.chatId, (turnRoute ?? route).threadId, {
        threadName: route.threadName
      });

      const finalizedPlan = this.planFinalizer.finalize(route.chatId, turnId);
      if (finalizedPlan.error) {
        routeLog.warn({ turnId, threadName: route.threadName }, finalizedPlan.error);
      }
      if (finalizedPlan.message) {
        await this.eventRouter.routeMessage(route.chatId, finalizedPlan.message);
      }

      // Build turn summary with diff data from git
      const key = contextKey(route.chatId, turnId);
      const turnContext = this.contexts.get(key);
      if (turnContext) {
        const summary = turnContext.context.toSummary();
        // Merge diff result into summary
        if (diff) {
          summary.filesChanged = diff.filesChanged;
          summary.fileChangeDetails = [{
            diffSummary: diff.diffSummary,
            filesChanged: diff.filesChanged,
            stats: diff.stats
          }];
        }
        turnContext.context.applyTurnSummary(summary);
        await this.callbacks.finalizeTurnState?.(route.chatId, turnId, turnContext.context.snapshot());
        await this.eventRouter.routeMessage(route.chatId, summary);
        this.contexts.delete(key);
      }
      this.planFinalizer.unregister(route.chatId, turnId);

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
