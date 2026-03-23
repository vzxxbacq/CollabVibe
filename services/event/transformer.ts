import type { IMOutputMessage } from "../event/im-output";

export interface TransformContext {
  projectId: string;
  threadId: string;
  turnId: string;
  threadName?: string;
}

import type { UnifiedAgentEvent } from "../../packages/agent-core/src/index";

function turnIdOf(event: UnifiedAgentEvent, fallback: string): string {
  return event.turnId && event.turnId.length > 0 ? event.turnId : fallback;
}

export function transformUnifiedAgentEvent(event: UnifiedAgentEvent, ctx: TransformContext): IMOutputMessage | null {
  switch (event.type) {
    case "content_delta":
      return { kind: "content", turnId: turnIdOf(event, ctx.turnId), delta: event.delta };
    case "reasoning_delta":
      return { kind: "reasoning", turnId: turnIdOf(event, ctx.turnId), delta: event.delta };
    case "plan_delta":
      return { kind: "plan", turnId: turnIdOf(event, ctx.turnId), delta: event.delta };
    case "plan_update":
      return {
        kind: "plan_update",
        turnId: turnIdOf(event, ctx.turnId),
        explanation: event.explanation,
        plan: event.plan
      };
    case "tool_output":
      return {
        kind: "tool_output",
        turnId: turnIdOf(event, ctx.turnId),
        callId: event.callId,
        delta: event.delta,
        source: event.source,
        format: event.format,
        byteLength: event.byteLength
      };
    case "tool_begin":
    case "tool_end":
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: event.type === "tool_begin" ? "begin" : "end",
        tool: event.tool,
        label: event.label,
        callId: event.callId,
        status: event.status,
        exitCode: event.exitCode,
        duration: event.duration,
        summary: event.summary,
        targetFile: event.targetFile,
        agentId: event.agentId
      };
    case "approval_request":
      return {
        kind: "approval",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        threadName: ctx.threadName,
        approvalId: event.approvalId,
        callId: event.callId,
        approvalType: event.approvalType,
        description: event.description,
        displayName: event.displayName,
        summary: event.summary,
        reason: event.reason,
        cwd: event.cwd,
        files: event.files,
        createdAt: new Date().toISOString(),
        command: event.command,
        changes: event.changes,
        availableActions: event.availableActions ?? ["approve", "deny", "approve_always"]
      };
    case "user_input":
      return {
        kind: "user_input",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        threadName: ctx.threadName,
        callId: event.callId,
        questions: event.questions
      };
    case "turn_started":
      return { kind: "notification", threadId: ctx.threadId, turnId: turnIdOf(event, ctx.turnId), category: "turn_started", title: event.title ?? "任务开始" };
    case "turn_complete":
      return { kind: "notification", threadId: ctx.threadId, turnId: turnIdOf(event, ctx.turnId), category: "turn_complete", title: "任务完成", lastAgentMessage: event.lastAgentMessage };
    case "turn_aborted":
      return { kind: "notification", threadId: ctx.threadId, turnId: turnIdOf(event, ctx.turnId), category: "turn_aborted", title: event.title ?? "任务中断" };
    case "token_usage":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        category: "token_usage",
        title: "Token 用量",
        tokenUsage: { input: event.input, output: event.output, total: event.total }
      };
    case "notification":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        category: event.category,
        title: event.title,
        detail: event.detail,
        lastAgentMessage: event.lastAgentMessage
      };
    default:
      return null;
  }
}
