import type { IMOutputMessage } from "./im-output";
import { AgentEventRouter } from "./router";
import type { NotificationSource, PipelineCallbacks, RouteBinding, ThreadRouteBinding } from "./pipeline-types";
import { ThreadRuntimeRegistry } from "./thread-runtime-registry";

export type { NotificationSource, PipelineCallbacks, RouteBinding, ThreadRouteBinding } from "./pipeline-types";

export class EventPipeline {
  private readonly registry: ThreadRuntimeRegistry;

  constructor(
    private readonly eventRouter: AgentEventRouter,
    private readonly callbacks: PipelineCallbacks,
    private readonly options?: {
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
    this.registry = new ThreadRuntimeRegistry(eventRouter, callbacks, options);
  }

  registerTurnCompleteHook(projectId: string, threadName: string, hook: (turnId: string) => Promise<void>): void {
    this.registry.getOrCreate(projectId, threadName).registerTurnCompleteHook(projectId, threadName, hook);
  }

  unregisterTurnCompleteHook(projectId: string, threadName: string): void {
    this.registry.getOrCreate(projectId, threadName).unregisterTurnCompleteHook(projectId, threadName);
  }

  async routeMessage(projectId: string, message: IMOutputMessage): Promise<void> {
    await this.eventRouter.routeMessage(projectId, message);
  }

  async waitForIdle(): Promise<void> {
    await Promise.all(this.registry.listAll().map((runtime) => runtime.waitForIdle()));
  }

  attachSource(source: NotificationSource, route: ThreadRouteBinding): void {
    this.registry.getOrCreate(route.projectId, route.threadName).attachSource(source, route);
  }

  prepareTurn(route: ThreadRouteBinding): void {
    this.registry.getOrCreate(route.projectId, route.threadName).prepareTurn(route);
  }

  activateTurn(route: RouteBinding): void {
    this.registry.bindTurn(route.projectId, route.threadName, route.turnId);
    this.registry.getOrCreate(route.projectId, route.threadName).activateTurn(route);
  }

  markTurnInterrupting(route: RouteBinding): void {
    this.registry.getOrCreate(route.projectId, route.threadName).markTurnInterrupting(route);
  }

  async updateTurnMetadata(projectId: string, turnId: string, metadata: {
    promptSummary?: string;
    backendName?: string;
    modelName?: string;
    turnMode?: "plan";
  }): Promise<boolean> {
    const indexedRuntime = this.registry.getByTurn(projectId, turnId);
    if (indexedRuntime) {
      return indexedRuntime.updateTurnMetadata(projectId, turnId, metadata);
    }
    for (const runtime of this.registry.listByProject(projectId)) {
      const updated = await runtime.updateTurnMetadata(projectId, turnId, metadata);
      if (updated) {
        return true;
      }
    }
    return false;
  }
}
