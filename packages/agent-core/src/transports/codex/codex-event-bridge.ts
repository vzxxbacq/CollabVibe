import { parseApprovalRequestEvent } from "./approval";
import { Buffer } from "node:buffer";
import { decodeToolOutput } from "./tool-output-decoder";
import { buildApprovalDisplay, nonEmptyString, stringArray, summarizeCommand, summarizeText } from "../../approval-display";
import type { RpcNotification } from "../../rpc-types";
import { parseDiffFileNames, parseDiffStats } from "../../../../git-utils/src/diff-parser";
import { createLogger } from "../../../../logger/src/index";

import type { UnifiedAgentEvent } from "../../unified-agent-event";
import type { ToolRequestUserInputParams } from "./generated/v2/ToolRequestUserInputParams";
import type { McpServerElicitationRequestParams } from "./generated/v2/McpServerElicitationRequestParams";

const log = createLogger("codex-factory");
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function inferCommandDisplayName(command: string[] | undefined): string {
  const first = command?.[0]?.trim().toLowerCase();
  if (first === "npm" || first === "pnpm" || first === "yarn" || first === "bun") return "Run package manager command";
  if (first === "git") return "Run git command";
  return "Run shell command";
}

function extractCodexApprovalDisplay(
  requestId: string,
  callId: string,
  approvalType: "command_exec" | "file_change",
  params: Record<string, unknown>
) {
  const command = typeof params.command === "string"
    ? [params.command]
    : stringArray(params.command);
  const reason = nonEmptyString(params.reason);
  const cwd = nonEmptyString(params.cwd);
  const files = stringArray(params.files);
  return buildApprovalDisplay({
    approvalType,
    requestId,
    callId,
    reason,
    cwd,
    files,
    command,
    displayNameCandidates: [approvalType === "command_exec" ? inferCommandDisplayName(command) : "Approve file changes"],
    summaryCandidates: [approvalType === "command_exec" ? summarizeCommand(command) : summarizeText(reason ?? files?.join(", "))],
    fallbackDisplayName: approvalType === "command_exec" ? "Run shell command" : "Approve file changes",
    fallbackDescription: approvalType === "command_exec" ? "command execution" : "File change approval"
  });
}

function readTurnId(payload: Record<string, unknown>): string {
  const turnId = payload.turnId;
  if (typeof turnId === "string") {
    return turnId;
  }
  const turn = asRecord(payload.turn);
  return stringOrEmpty(turn?.id);
}

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
    case "item/agentMessage/delta":
      return {
        type: "agent_message_content_delta",
        turn_id: stringOrEmpty(params.turnId),
        delta: params.delta
      };
    case "item/reasoning/textDelta":
    case "item/reasoning/summary/textDelta":
      return {
        type: "reasoning_content_delta",
        turn_id: stringOrEmpty(params.turnId),
        delta: params.delta
      };
    case "item/plan/delta":
      return {
        type: "plan_delta",
        turn_id: stringOrEmpty(params.turnId),
        delta: params.delta
      };
    case "item/commandExecution/outputDelta":
      return {
        type: "exec_command_output_delta",
        turn_id: stringOrEmpty(params.turnId),
        call_id: params.itemId,
        chunk: params.delta
      };
    case "item/terminalInteraction":
      return {
        type: "terminal_interaction",
        turn_id: stringOrEmpty(params.turnId),
        call_id: params.itemId,
        stdin: params.stdin
      };
    case "thread/tokenUsage/updated": {
      const tokenUsage = asRecord(params.tokenUsage);
      const last = asRecord(tokenUsage?.last);
      return {
        type: "token_count",
        turn_id: stringOrEmpty(params.turnId),
        info: {
          last_token_usage: {
            input_tokens: last?.inputTokens,
            output_tokens: last?.outputTokens,
            total_tokens: last?.totalTokens
          }
        }
      };
    }
    case "skills/changed":
      return {
        type: "skills_changed",
        skills: params.skills ?? []
      };
    case "model/rerouted":
      return {
        type: "model_reroute",
        turn_id: stringOrEmpty(params.turnId),
        from_model: params.fromModel,
        to_model: params.toModel
      };
    case "context/compacted":
      return {
        type: "context_compacted",
        turn_id: stringOrEmpty(params.turnId)
      };
    case "error":
      return {
        type: "error",
        turn_id: stringOrEmpty(params.turnId),
        message: asRecord(params.error)?.message ?? "error"
      };
    case "turn/plan/updated":
      return {
        type: "plan_update",
        turn_id: String(params.turnId ?? ""),
        explanation: params.explanation,
        plan: params.plan
      };
    case "turn/completed":
      return {
        type: (() => {
          const turn = asRecord(params.turn);
          const status = stringOrEmpty(turn?.status);
          return status === "interrupted" ? "turn_aborted" : "task_complete";
        })(),
        turn_id: readTurnId(params),
        last_agent_message: params.lastAgentMessage
      };
    case "turn/started":
      return {
        type: "task_started",
        turn_id: readTurnId(params)
      };
    case "thread/status/changed": {
      // Map "resumed from waitingOnUserInput" to a visible notification
      const activeFlags = params.activeFlags;
      const isResumed = Array.isArray(activeFlags) && activeFlags.length === 0;
      if (isResumed) {
        return {
          type: "thread_status_resumed",
          turn_id: stringOrEmpty(params.turnId)
        };
      }
      return null;
    }
    default:
      break;
  }

  return null;
}

function itemNotificationToUnifiedEvent(notification: RpcNotification): UnifiedAgentEvent | null {
  const params = notification.params as Record<string, unknown>;
  const item = asRecord(params.item);
  if (!item) {
    return null;
  }

  const turnId = stringOrEmpty(params.turnId);
  const itemId = stringOrEmpty(item.id);
  const itemType = stringOrEmpty(item.type);

  if (notification.method === "item/started") {
    switch (itemType) {
      case "commandExecution":
        return {
          type: "tool_begin",
          turnId,
          callId: itemId,
          tool: "exec_command",
          label: stringOrEmpty(item.command)
        };
      case "fileChange":
        return {
          type: "tool_begin",
          turnId,
          callId: itemId,
          tool: "patch_apply",
          label: "应用补丁"
        };
      case "mcpToolCall":
        return {
          type: "tool_begin",
          turnId,
          callId: itemId,
          tool: "mcp_tool",
          label: `调用 MCP 工具: ${stringOrEmpty(item.tool) || "unknown"}`
        };
      case "webSearch":
        return {
          type: "tool_begin",
          turnId,
          callId: itemId,
          tool: "web_search",
          label: stringOrEmpty(item.query) || "执行 Web 搜索"
        };
      case "collabAgentToolCall":
        return {
          type: "tool_begin",
          turnId,
          callId: itemId,
          tool: "collab_agent",
          label: stringOrEmpty(item.tool) || "协作 Agent"
        };
      case "reasoning":
        // Empty reasoning started → weak progress hint ("正在推理")
        return {
          type: "tool_begin",
          turnId,
          callId: itemId,
          tool: "mcp_tool",
          label: "正在推理"
        };
      default:
        return null;
    }
  }

  if (notification.method !== "item/completed") {
    return null;
  }

  switch (itemType) {
    case "agentMessage":
      return {
        type: "notification",
        turnId,
        category: "agent_message",
        title: "Agent 回复",
        lastAgentMessage: stringOrEmpty(item.text)
      };
    case "commandExecution": {
      const status = stringOrEmpty(item.status);
      return {
        type: "tool_end",
        turnId,
        callId: itemId,
        tool: "exec_command",
        label: stringOrEmpty(item.command),
        summary: typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : undefined,
        status: status === "completed" ? "success" : "failed",
        exitCode: typeof item.exitCode === "number" ? item.exitCode : undefined,
        duration: typeof item.durationMs === "number" ? `${item.durationMs}ms` : undefined
      };
    }
    case "fileChange": {
      const status = stringOrEmpty(item.status);
      return {
        type: "tool_end",
        turnId,
        callId: itemId,
        tool: "patch_apply",
        label: "补丁完成",
        status: status === "completed" ? "success" : "failed"
      };
    }
    case "mcpToolCall": {
      const status = stringOrEmpty(item.status);
      return {
        type: "tool_end",
        turnId,
        callId: itemId,
        tool: "mcp_tool",
        label: `MCP 工具完成: ${stringOrEmpty(item.tool) || "unknown"}`,
        status: status === "completed" ? "success" : "failed",
        duration: typeof item.durationMs === "number" ? `${item.durationMs}ms` : undefined
      };
    }
    case "webSearch":
      return {
        type: "tool_end",
        turnId,
        callId: itemId,
        tool: "web_search",
        label: "Web 搜索完成",
        status: "success"
      };
    case "collabAgentToolCall": {
      const status = stringOrEmpty(item.status);
      const receiverThreadIds = Array.isArray(item.receiverThreadIds)
        ? item.receiverThreadIds.filter((value): value is string => typeof value === "string")
        : [];
      return {
        type: "tool_end",
        turnId,
        callId: itemId,
        tool: "collab_agent",
        label: stringOrEmpty(item.tool) || "协作 Agent",
        status: status === "completed" ? "success" : "failed",
        agentId: receiverThreadIds[0]
      };
    }
    case "reasoning":
      // Empty reasoning completed → end the progress hint
      return {
        type: "tool_end",
        turnId,
        callId: itemId,
        tool: "mcp_tool",
        label: "推理完成",
        status: "success"
      };
    default:
      return null;
  }
}

export function codexNotificationToUnifiedEvent(notification: RpcNotification): UnifiedAgentEvent | null {
  const itemEvent = itemNotificationToUnifiedEvent(notification);
  if (itemEvent) {
    return itemEvent;
  }

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
    case "exec_command_output_delta": {
      const output = decodeToolOutput(String((event as { chunk?: unknown }).chunk ?? ""));
      return {
        type: "tool_output",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? "unknown"),
        delta: output.text,
        source: String((event as { stream?: unknown }).stream ?? "stdout") === "stderr" ? "stderr" : "stdout",
        format: output.format,
        byteLength: output.byteLength
      };
    }
    case "terminal_interaction":
      return {
        type: "tool_output",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? "stdin"),
        delta: String((event as { stdin?: unknown }).stdin ?? ""),
        source: "stdin",
        format: "text",
        byteLength: Buffer.byteLength(String((event as { stdin?: unknown }).stdin ?? ""), "utf8")
      };
    case "exec_command_begin":
      return {
        type: "tool_begin",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        tool: "exec_command",
        label: ((event as { command?: string[] }).command ?? []).join(" ")
      };
    case "exec_command_end": {
      const summary = decodeToolOutput(String((event as { aggregated_output?: unknown }).aggregated_output ?? ""));
      return {
        type: "tool_end",
        turnId: String((event as { turn_id?: string }).turn_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        tool: "exec_command",
        label: ((event as { command?: string[] }).command ?? []).join(" "),
        summary: summary.text,
        status: (event as { status?: string }).status === "completed" ? "success" : "failed",
        exitCode: (event as { exit_code?: number }).exit_code,
        duration: (event as { duration?: string }).duration
      };
    }
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
        output: Number((event as { info?: { last_token_usage?: { output_tokens?: number; total_tokens?: number } } }).info?.last_token_usage?.output_tokens ?? 0),
        total: Number((event as { info?: { last_token_usage?: { total_tokens?: number } } }).info?.last_token_usage?.total_tokens ?? 0)
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
      log.debug("codex notification dropped: skills_changed treated as internal invalidation signal");
      return null;
    case "thread_status_resumed":
      return { type: "notification", turnId: String((event as { turn_id?: string }).turn_id ?? ""), category: "warning", title: "已收到你的选择，继续执行" };
    default:
      log.debug({ type: event.type }, "codex notification ignored: unsupported event type");
      return null;
  }
}

// Export alias
export const codexEventToUnifiedAgentEvent = codexNotificationToUnifiedEvent;

/**
 * Convert a server-initiated JSON-RPC request (approval) to UnifiedAgentEvent.
 * The JSON-RPC `id` is preserved as `backendApprovalId` for later transport response.
 */
export function codexServerRequestToUnifiedEvent(request: {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}): UnifiedAgentEvent | null {
  if (request.method === "item/commandExecution/requestApproval") {
    const p = request.params;
    const backendApprovalId = String(request.id);
    const callId = String(p.itemId ?? "");
    const display = extractCodexApprovalDisplay(backendApprovalId, callId, "command_exec", p);

    return {
      type: "approval_request",
      turnId: String(p.turnId ?? ""),
      approvalId: backendApprovalId,
      backendApprovalId,
      callId,
      approvalType: "command_exec",
      description: display.description,
      displayName: display.displayName,
      summary: display.summary,
      reason: display.reason,
      cwd: display.cwd,
      files: display.files,
      command: display.command,
      availableActions: ["approve", "deny", "approve_always"],
      backendType: "codex"
    };
  }
  if (request.method === "item/fileChange/requestApproval") {
    const p = request.params;
    const backendApprovalId = String(request.id);
    const callId = String(p.itemId ?? "");
    const display = extractCodexApprovalDisplay(backendApprovalId, callId, "file_change", p);
    return {
      type: "approval_request",
      turnId: String(p.turnId ?? ""),
      approvalId: backendApprovalId,
      backendApprovalId,
      callId,
      approvalType: "file_change",
      description: display.description,
      displayName: display.displayName,
      summary: display.summary,
      reason: display.reason,
      cwd: display.cwd,
      files: display.files,
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
