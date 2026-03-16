import { TurnContext, createLogger } from "../../../../packages/channel-core/src/index";
import type { IMOutputMessage } from "../../../../packages/channel-core/src/im-output";
import type { CodexNotification } from "../../../../packages/codex-client/src/index";
import type { TurnDiffResult } from "../../../../packages/git-utils/src/commit";

import { AgentEventRouter } from "./router";
import { codexEventToUnifiedAgentEvent } from "../../../../packages/codex-client/src/codex-event-bridge";
import type { UnifiedAgentEvent } from "../../../../packages/agent-core/src/unified-agent-event";
import { transformUnifiedAgentEvent } from "./transformer";
import { PlanTurnFinalizer } from "./plan-finalizer";

interface NotificationSource {
  onNotification(handler: (notification: CodexNotification | UnifiedAgentEvent) => void): void;
}

export interface RouteBinding {
  chatId: string;
  userId?: string;
  traceId?: string;
  threadName: string;
  threadId: string;
  turnId: string;
  cwd?: string;
  turnMode?: "plan";
  isMergeResolver?: boolean;
  /** Phase 2: Agent resolving conflicts in worktree */
  isMergeConflictResolver?: boolean;
  /** Phase 2: single-file retry — filePath to re-check after Agent turn */
  mergeRetryFilePath?: string;
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
  onResolverTurnComplete(chatId: string, resolverName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string }): Promise<void>;
  /** Phase 2: Called when Agent finishes batch conflict resolution */
  onMergeConflictResolved?(chatId: string, branchName: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string }): Promise<void>;
  /** Phase 2: Called when Agent finishes retrying a single file */
  onMergeFileRetryDone?(chatId: string, branchName: string, filePath: string, context?: { traceId?: string; threadId?: string; turnId?: string; userId?: string }): Promise<void>;
}

interface TurnContextEntry {
  context: TurnContext;
  createdAt: number;
}

function contextKey(chatId: string, turnId: string): string {
  return `${chatId}:${turnId}`;
}

function turnIdFromEvent(event: UnifiedAgentEvent, fallback: string): string {
  return event.turnId && event.turnId.length > 0 ? event.turnId : fallback;
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
  private readonly sourceRoutes = new WeakMap<NotificationSource, RouteBinding>();
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

  bind(source: NotificationSource, route: RouteBinding): void {
    this.sourceRoutes.set(source, route);
    this.planFinalizer.registerRoute(route);
    this.eventRouter.registerRoute(route.chatId, {
      chatId: route.chatId,
      threadName: route.threadName,
      threadId: route.threadId,
      turnId: route.turnId
    });

    // Clear stale dedup entry — allows the new turn to complete even if a
    // previous turn on the same bound-chat turn key was already finished.
    this.finishedTurns.delete(`${route.chatId}:${route.turnId}`);

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
          turnId: activeRoute.turnId,
          err: error instanceof Error ? error.message : String(error)
        }, "event pipeline notification handling failed");
      });
    });
  }

  private getTurnContext(route: RouteBinding, turnId: string): TurnContext {
    const key = contextKey(route.chatId, turnId);
    const existing = this.contexts.get(key);
    if (existing) {
      return existing.context;
    }
    const created = new TurnContext(route.threadId, turnId, route.threadName);
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

  private async handleNotification(route: RouteBinding, notification: CodexNotification | UnifiedAgentEvent): Promise<void> {
    const routeLog = log.child({
      chatId: route.chatId,
      traceId: route.traceId,
      userId: route.userId,
      threadName: route.threadName,
      threadId: route.threadId,
      turnId: route.turnId
    });
    this.pruneExpiredContexts(Date.now());
    const event = toUnified(notification);
    if (!event) {
      routeLog.debug("event pipeline dropped non-unified notification");
      return;
    }

    const turnId = turnIdFromEvent(event, route.turnId);
    const callbackContext = { traceId: route.traceId, threadId: route.threadId, turnId, userId: route.userId };
    const transformCtx = { chatId: route.chatId, threadId: route.threadId, turnId, threadName: route.threadName };
    const message = transformUnifiedAgentEvent(event, transformCtx);

    const shouldRouteToUi = !(route.isMergeConflictResolver);
    if (message) {
      this.planFinalizer.ingestMessage(route.chatId, message);
      const turnContext = this.getTurnContext(route, turnId);
      if (message.kind === "notification" && message.category === "token_usage") {
        turnContext.setTokenUsage(message.tokenUsage);
      } else if (message.kind === "notification" && message.lastAgentMessage) {
        turnContext.setLastAgentMessage(message.lastAgentMessage);
      }
      if (shouldRouteToUi) {
        await this.eventRouter.routeMessage(route.chatId, message);
      }
    }

    if (event.type === "approval_request") {
      this.callbacks.registerApprovalRequest({
        chatId: route.chatId,
        userId: route.userId,
        approvalId: event.approvalId,
        threadId: route.threadId,
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
      const diff = await this.callbacks.finishTurn(route.chatId, route.threadId, {
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
        await this.eventRouter.routeMessage(route.chatId, summary);
        this.contexts.delete(key);
      }
      this.planFinalizer.unregister(route.chatId, turnId);

      // Resolver thread completion → trigger post-resolution merge flow
      if (event.type === "turn_complete" && route.isMergeResolver) {
        this.callbacks.onResolverTurnComplete(route.chatId, route.threadName, callbackContext).catch((error) => {
          routeLog.warn({ err: error instanceof Error ? error.message : String(error) }, "resolver completion callback failed");
        });
      }

      // Phase 2: Merge conflict resolver turn completion
      if (event.type === "turn_complete" && route.isMergeConflictResolver) {
        if (route.mergeRetryFilePath) {
          this.callbacks.onMergeFileRetryDone?.(route.chatId, route.threadName, route.mergeRetryFilePath, callbackContext)
            .catch((error) => {
              routeLog.warn({ err: error instanceof Error ? error.message : String(error), filePath: route.mergeRetryFilePath }, "merge file retry completion callback failed");
            });
        } else {
          this.callbacks.onMergeConflictResolved?.(route.chatId, route.threadName, callbackContext)
            .catch((error) => {
              routeLog.warn({ err: error instanceof Error ? error.message : String(error) }, "merge conflict resolved callback failed");
            });
        }
      }
    }
  }
}
