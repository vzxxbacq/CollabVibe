import { parseApprovalRequestEvent } from "./approval";
import type { RpcNotification } from "../../agent-core/src/rpc-types";
import { parseDiffFileNames, parseDiffStats } from "../../channel-core/src/diff-parser";
import { createLogger } from "../../channel-core/src/index";

import type { UnifiedAgentEvent } from "../../agent-core/src/unified-agent-event";
import type { ToolRequestUserInputParams } from "./generated/v2/ToolRequestUserInputParams";
import type { McpServerElicitationRequestParams } from "./generated/v2/McpServerElicitationRequestParams";

const log = createLogger("codex-factory");

function toEventMessage(notification: RpcNotification): Record<string, unknown> | null {
  const params = notification.params as Record<string, unknown>;

  if (typeof params.type === "string") {
    return params;
  }

  const nestedEvent = params.event;
  if (typeof nestedEvent === "object" && nestedEvent !== null && typeof (nestedEvent as { type?: unknown }).type === "string") {
    return nestedEvent as Record<string, unknown>;
  }

  const nestedMsg = params.msg;
  if (typeof nestedMsg === "object" && nestedMsg !== null && typeof (nestedMsg as { type?: unknown }).type === "string") {
    return nestedMsg as Record<string, unknown>;
  }

  if (notification.method.startsWith("codex/event/")) {
    const eventType = notification.method.slice("codex/event/".length);
    const data = typeof nestedMsg === "object" && nestedMsg !== null
      ? nestedMsg as Record<string, unknown>
      : params;
    return { ...data, type: eventType };
  }

  switch (notification.method) {
    case "turn/plan/updated":
      return {
        type: "plan_update",
        turn_id: String(params.turnId ?? ""),
        explanation: params.explanation,
        plan: params.plan
      };
    case "turn/completed":
      return {
        type: "task_complete",
        turn_id: String(params.turnId ?? ""),
        last_agent_message: params.lastAgentMessage
      };
    case "turn/started":
      return {
        type: "task_started",
        turn_id: String(params.turnId ?? "")
      };
    default:
      break;
  }

  return null;
}

function decodeOutput(rawChunk: string): string {
  try {
    return Buffer.from(rawChunk, "base64").toString("utf-8").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  } catch {
    return rawChunk;
  }
}

export function codexNotificationToUnifiedEvent(notification: RpcNotification): UnifiedAgentEvent | null {
  const event = toEventMessage(notification);
  if (!event) {
    log.debug({ method: notification.method }, "codex notification dropped: no event payload");
    return null;
  }

  // Legacy approval notifications are intentionally SKIPPED here.
  // Codex sends BOTH a legacy notification (exec_approval_request) AND a v2 server
  // request (item/commandExecution/requestApproval) for approvals. The v2 path via
  // codexServerRequestToUnifiedEvent correctly uses JSON-RPC request.id as approvalId,
  // while the legacy path falls back to callId (wrong). Only handle approvals via v2.
  const approval = parseApprovalRequestEvent(event);
  if (approval) {
    log.debug({ type: event.type }, "codex notification dropped: approval handled via server request");
    return null;
  }

  // Skip request_user_input / elicitation_request notifications.
  // Codex sends BOTH a notification AND a v2 server request for user input.
  // The v2 path (codexServerRequestToUnifiedEvent) carries the JSON-RPC id
  // needed for responding. Only handle user input via the v2 server request.
  if (event.type === "request_user_input" || event.type === "elicitation_request") {
    log.debug({ type: event.type }, "codex notification dropped: user input handled via server request");
    return null;
  }

  switch (event.type) {
    case "agent_message_content_delta":
      return { type: "content_delta", turnId: String((event as { turn_id?: string }).turn_id ?? ""), delta: String((event as { delta?: unknown }).delta ?? "") };
    case "agent_reasoning_delta":
    case "reasoning_content_delta":
    case "reasoning_raw_content_delta":
      return { type: "reasoning_delta", turnId: String((event as { turn_id?: string }).turn_id ?? ""), delta: String((event as { delta?: unknown }).delta ?? "") };
    case "plan_delta":
      return { type: "plan_delta", turnId: String((event as { turn_id?: string }).turn_id ?? ""), delta: String((event as { delta?: unknown }).delta ?? "") };
    case "plan_update":
      return {
        type: "plan_update",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        explanation: typeof (event as { explanation?: unknown }).explanation === "string"
          ? (event as { explanation?: string }).explanation
          : undefined,
        plan: Array.isArray((event as { plan?: unknown }).plan)
          ? ((event as { plan?: Array<{ step?: unknown; status?: unknown }> }).plan ?? []).map((item) => ({
            step: String(item.step ?? ""),
            status: item.status === "completed" || item.status === "in_progress" || item.status === "pending"
              ? item.status
              : "pending"
          }))
          : []
      };
    case "exec_command_output_delta":
      return {
        type: "tool_output",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? "unknown"),
        delta: decodeOutput(String((event as { chunk?: unknown }).chunk ?? "")),
        source: "stdout"
      };
    case "terminal_interaction":
      return {
        type: "tool_output",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? "stdin"),
        delta: String((event as { stdin?: unknown }).stdin ?? ""),
        source: "stdin"
      };
    case "exec_command_begin":
      return {
        type: "tool_begin",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        tool: "exec_command",
        label: ((event as { command?: string[] }).command ?? []).join(" ")
      };
    case "exec_command_end":
      return {
        type: "tool_end",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        tool: "exec_command",
        label: ((event as { command?: string[] }).command ?? []).join(" "),
        summary: (event as { aggregated_output?: string }).aggregated_output,
        status: (event as { status?: string }).status === "completed" ? "success" : "failed",
        exitCode: (event as { exit_code?: number }).exit_code,
        duration: (event as { duration?: string }).duration
      };
    case "mcp_tool_call_begin":
      return { type: "tool_begin", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "mcp_tool", label: `调用 MCP 工具: ${String((event as { invocation?: { tool?: unknown } }).invocation?.tool ?? "unknown")}` };
    case "mcp_tool_call_end":
      return { type: "tool_end", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "mcp_tool", label: `MCP 工具完成: ${String((event as { invocation?: { tool?: unknown } }).invocation?.tool ?? "unknown")}`, status: (event as { result?: unknown }).result && "Err" in ((event as { result?: object }).result ?? {}) ? "failed" : "success", duration: (event as { duration?: string }).duration };
    case "web_search_begin":
      return { type: "tool_begin", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "web_search", label: "执行 Web 搜索" };
    case "web_search_end":
      return { type: "tool_end", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "web_search", label: "Web 搜索完成" };
    case "image_generation_begin":
      return { type: "tool_begin", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "image_gen", label: "生成图片" };
    case "image_generation_end":
      return { type: "tool_end", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "image_gen", label: "图片生成完成" };
    case "patch_apply_begin":
      return { type: "tool_begin", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "patch_apply", label: "应用补丁" };
    case "patch_apply_end":
      return { type: "tool_end", turnId: String((event as { turn_id?: string }).turn_id ?? ""), tool: "patch_apply", label: "补丁完成", status: (event as { success?: boolean }).success ? "success" : "failed" };
    case "task_started":
      return { type: "turn_started", turnId: String((event as { turn_id?: string }).turn_id ?? "") };
    case "task_complete":
      return { type: "turn_complete", turnId: String((event as { turn_id?: string }).turn_id ?? ""), lastAgentMessage: (event as { last_agent_message?: string }).last_agent_message };
    case "turn_aborted":
      return { type: "turn_aborted", turnId: String((event as { turn_id?: string }).turn_id ?? "") };
    case "token_count":
      return {
        type: "token_usage",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        input: Number((event as { info?: { last_token_usage?: { input_tokens?: number } } }).info?.last_token_usage?.input_tokens ?? 0),
        output: Number((event as { info?: { last_token_usage?: { output_tokens?: number } } }).info?.last_token_usage?.output_tokens ?? 0)
      };
    case "warning":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "warning", title: String((event as { message?: unknown }).message ?? "warning") };
    case "error":
    case "stream_error":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "error", title: String((event as { message?: unknown }).message ?? "error") };
    case "model_reroute":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "model_reroute", title: "模型已切换", detail: `${String((event as { from_model?: unknown }).from_model ?? "")} -> ${String((event as { to_model?: unknown }).to_model ?? "")}`.trim() };
    case "context_compacted":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "context_compacted", title: "上下文已压缩" };
    case "undo_started":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "undo_started", title: String((event as { message?: string | null }).message ?? "开始回滚") };
    case "undo_completed":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "undo_completed", title: String((event as { message?: string | null }).message ?? "回滚完成"), detail: (event as { success?: boolean }).success ? "success" : "failed" };
    case "deprecation_notice":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "deprecation", title: String((event as { summary?: unknown }).summary ?? "能力弃用通知"), detail: String((event as { details?: unknown }).details ?? "") };
    case "agent_message":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "agent_message", title: "Agent 回复", lastAgentMessage: String((event as { message?: unknown }).message ?? "") };
    case "skills_changed":
      return {
        type: "notification",
        turnId: "",
        category: "skills_changed",
        title: "Skills 已更新",
        detail: JSON.stringify((event as { skills?: unknown }).skills ?? [])
      };
    default:
      log.debug({ type: event.type }, "codex notification ignored: unsupported event type");
      return null;
  }
}

// Backward compatibility alias
export const codexEventToUnifiedAgentEvent = codexNotificationToUnifiedEvent;

/**
 * Convert a server-initiated JSON-RPC request (approval) to UnifiedAgentEvent.
 * The JSON-RPC `id` is stored as `approvalId` for responding later.
 */
export function codexServerRequestToUnifiedEvent(request: {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}): UnifiedAgentEvent | null {
  if (request.method === "item/commandExecution/requestApproval") {
    const p = request.params;

    return {
      type: "approval_request",
      turnId: String(p.turnId ?? ""),
      approvalId: String(request.id),
      callId: String(p.itemId ?? ""),
      approvalType: "command_exec",
      description: `Command approval: ${String(p.command ?? "")}`,
      command: typeof p.command === "string" ? [p.command] : Array.isArray(p.command) ? p.command as string[] : undefined,
      availableActions: ["approve", "deny", "approve_always"],
      backendType: "codex"
    };
  }
  if (request.method === "item/fileChange/requestApproval") {
    const p = request.params;
    return {
      type: "approval_request",
      turnId: String(p.turnId ?? ""),
      approvalId: String(request.id),
      callId: String(p.itemId ?? ""),
      approvalType: "file_change",
      description: String(p.reason ?? "File change approval"),
      availableActions: ["approve", "deny", "approve_always"],
      backendType: "codex"
    };
  }
  if (request.method === "item/tool/requestUserInput") {
    const p = request.params as unknown as ToolRequestUserInputParams;
    return {
      type: "user_input",
      turnId: String(p.turnId ?? ""),
      callId: String(request.id),
      questions: (p.questions ?? []).map(q => ({
        id: q.id,
        text: q.question ?? q.header ?? "",
        options: q.options?.map(o => o.label).filter(Boolean)
      }))
    };
  }
  if (request.method === "mcpServer/elicitation/request") {
    const p = request.params as unknown as McpServerElicitationRequestParams;
    return {
      type: "user_input",
      turnId: String(p.turnId ?? ""),
      callId: String(request.id),
      questions: [{ text: String(p.message ?? "需要用户输入") }]
    };
  }
  return null;
}
