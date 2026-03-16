import { transformEvent, type AgentStreamOutput, type IMOutputMessage, type TransformContext } from "../../../../packages/channel-core/src/index";

import { transformUnifiedAgentEvent } from "./transformer";
import type { UnifiedAgentEvent } from "../../../../packages/agent-core/src/unified-agent-event";

interface RouteTarget extends TransformContext {
  threadName: string;
}

function projectThreadRouteKey(chatId: string, threadName: string): string {
  return `${chatId}:${threadName}`;
}

export class AgentEventRouter {
  private readonly outputAdapter: AgentStreamOutput;
  private readonly persistMessage?: (chatId: string, message: IMOutputMessage) => Promise<void>;

  private readonly routes = new Map<string, RouteTarget>();

  constructor(outputAdapter: AgentStreamOutput, options?: {
    persistMessage?: (chatId: string, message: IMOutputMessage) => Promise<void>;
  }) {
    this.outputAdapter = outputAdapter;
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
    switch (message.kind) {
      case "content":
        await this.outputAdapter.appendContent(chatId, message.turnId, message.delta);
        break;
      case "reasoning":
        await this.outputAdapter.appendReasoning(chatId, message.turnId, message.delta);
        break;
      case "plan":
        await this.outputAdapter.appendPlan(chatId, message.turnId, message.delta);
        break;
      case "plan_update":
        if (this.outputAdapter.updatePlan) {
          await this.outputAdapter.updatePlan(chatId, message);
        } else {
          const summary = [message.explanation, ...message.plan.map((item) => `${item.status}: ${item.step}`)]
            .filter(Boolean)
            .join("\n");
          await this.outputAdapter.appendPlan(chatId, message.turnId, summary);
        }
        break;
      case "tool_output":
        await this.outputAdapter.appendToolOutput(chatId, message);
        break;
      case "progress":
        await this.outputAdapter.updateProgress(chatId, message);
        break;
      case "approval":
        await this.outputAdapter.requestApproval(chatId, message);
        break;
      case "user_input":
        await this.outputAdapter.requestUserInput(chatId, message);
        break;
      case "notification":
        await this.outputAdapter.notify(chatId, message);
        break;
      case "turn_summary":
        await this.outputAdapter.completeTurn(chatId, message);
        break;
      case "merge_review":
        await this.outputAdapter.sendFileReview(chatId, message.review);
        break;
      case "merge_summary":
        await this.outputAdapter.sendMergeSummary(chatId, message.summary);
        break;
      case "merge_timeout":
        await this.outputAdapter.notify(chatId, {
          kind: "notification", threadId: "", category: "warning",
          title: `⏰ 合并审阅已超时`,
          detail: `分支 ${message.branchName} 的合并审阅已超时，已自动取消`,
        });
        break;
      default:
        break;
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
