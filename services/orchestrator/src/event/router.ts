import { transformEvent, type TransformContext } from "../../../contracts/im/event-transformer";
import type { IMOutputMessage } from "../../../contracts/im/im-output";
import type { PlatformOutput } from "../../../contracts/im/platform-output";

import { transformUnifiedAgentEvent } from "./transformer";
import type { UnifiedAgentEvent } from "../../../../packages/agent-core/src/unified-agent-event";

/**
 * Callback that dispatches a PlatformOutput to the IM layer.
 * Injected at the composition root (server.ts) — the orchestrator service
 * never holds a direct reference to IM platform adapters.
 */
export type OutputDispatchFn = (chatId: string, output: PlatformOutput) => Promise<void>;

interface RouteTarget extends TransformContext {
  threadName: string;
}

function projectThreadRouteKey(chatId: string, threadName: string): string {
  return `${chatId}:${threadName}`;
}

export class AgentEventRouter {
  private readonly dispatchOutput: OutputDispatchFn;
  private readonly persistMessage?: (chatId: string, message: IMOutputMessage) => Promise<void>;

  private readonly routes = new Map<string, RouteTarget>();

  constructor(dispatchOutput: OutputDispatchFn, options?: {
    persistMessage?: (chatId: string, message: IMOutputMessage) => Promise<void>;
  }) {
    this.dispatchOutput = dispatchOutput;
    this.persistMessage = options?.persistMessage;
  }

  registerRoute(chatId: string, route: RouteTarget): void {
    this.routes.set(projectThreadRouteKey(chatId, route.threadName), route);
  }

  async routeEvent(chatId: string, threadName: string, event: UnifiedAgentEvent | { type: string;[key: string]: unknown }): Promise<void> {
    const target = this.routes.get(projectThreadRouteKey(chatId, threadName));
    if (!target) {
      throw new Error(`missing project-thread route for ${chatId}/${threadName}`);
    }

    const message = isUnifiedAgentEvent(event)
      ? transformUnifiedAgentEvent(event, target)
      : transformEvent(event, target);
    if (!message) {
      return;
    }

    await this.routeMessage(chatId, message);
  }

  async routeMessage(chatId: string, message: IMOutputMessage): Promise<void> {
    if (this.persistMessage) {
      await this.persistMessage(chatId, message);
    }
    await this.dispatchOutput(chatId, toPlatformOutput(message));
  }
}

function toPlatformOutput(message: IMOutputMessage): PlatformOutput {
  switch (message.kind) {
    case "content":
      return { kind: "content", data: message };
    case "reasoning":
      return { kind: "reasoning", data: message };
    case "plan":
      return { kind: "plan", data: message };
    case "plan_update":
      return { kind: "plan_update", data: message };
    case "tool_output":
      return { kind: "tool_output", data: message };
    case "progress":
      return { kind: "progress", data: message };
    case "approval":
      return { kind: "approval_request", data: message };
    case "user_input":
      return { kind: "user_input_request", data: message };
    case "notification":
      return { kind: "notification", data: message };
    case "turn_summary":
      return { kind: "turn_summary", data: message };
    case "merge_review":
      return { kind: "merge_review", data: message.review };
    case "merge_summary":
      return { kind: "merge_summary", data: message.summary };
    case "merge_timeout":
      return {
        kind: "merge_timeout",
        chatId: message.chatId,
        branchName: message.branchName
      };
    default: {
      const exhaustive: never = message;
      return exhaustive;
    }
  }
}

function isUnifiedAgentEvent(event: UnifiedAgentEvent | { type: string; [key: string]: unknown }): event is UnifiedAgentEvent {
  return typeof event.type === "string" && [
    "content_delta", "reasoning_delta", "plan_delta", "tool_output", "tool_begin", "tool_end",
    "plan_update",
    "approval_request", "user_input", "turn_started", "turn_complete", "turn_aborted",
    "token_usage", "notification"
  ].includes(event.type);
}
