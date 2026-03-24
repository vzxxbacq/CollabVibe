import type { TransformContext } from "./transformer";
import type { IMOutputMessage } from "../event/im-output";
import type { PlatformOutput } from "./output-contracts";

import { transformUnifiedAgentEvent } from "./transformer";
import type { UnifiedAgentEvent } from "../../packages/agent-core/src/index";
import { toPlatformOutput } from "./output-mapper";
import { projectThreadRouteKey } from "./router-keys";
import { OutputIntentBuffer } from "./output-intent-buffer";

/**
 * Callback that dispatches a PlatformOutput to the IM layer.
 * Injected at the composition root (server.ts) — the orchestrator service
 * never holds a direct reference to IM platform adapters.
 */
export type OutputDispatchFn = (projectId: string, output: PlatformOutput) => Promise<void>;

export interface RouteTarget extends TransformContext {
  threadName: string;
}

export class AgentEventRouter {
  private readonly dispatchOutput: OutputDispatchFn;
  private readonly persistMessage?: (projectId: string, message: IMOutputMessage) => Promise<void>;
  private readonly intentBuffer?: OutputIntentBuffer;

  private readonly routes = new Map<string, RouteTarget>();

  constructor(dispatchOutput: OutputDispatchFn, options?: {
    persistMessage?: (projectId: string, message: IMOutputMessage) => Promise<void>;
    intentBuffer?: OutputIntentBuffer;
  }) {
    this.dispatchOutput = dispatchOutput;
    this.persistMessage = options?.persistMessage;
    this.intentBuffer = options?.intentBuffer;
  }

  registerRoute(projectId: string, route: RouteTarget): void {
    this.routes.set(projectThreadRouteKey(projectId, route.threadName), route);
  }

  async routeEvent(projectId: string, threadName: string, event: UnifiedAgentEvent): Promise<void> {
    const target = this.routes.get(projectThreadRouteKey(projectId, threadName));
    if (!target) {
      throw new Error(`missing project-thread route for ${projectId}/${threadName}`);
    }

    const message = transformUnifiedAgentEvent(event, target);
    if (!message) {
      return;
    }

    await this.routeMessage(projectId, message);
  }

  async routeMessage(projectId: string, message: IMOutputMessage, options?: { skipPersist?: boolean }): Promise<void> {
    if (this.persistMessage && !options?.skipPersist) {
      await this.persistMessage(projectId, message);
    }
    const output = toPlatformOutput(message);
    if (this.intentBuffer) {
      await this.intentBuffer.enqueuePlatformOutput(projectId, output);
      return;
    }
    await this.dispatchOutput(projectId, output);
  }
}
