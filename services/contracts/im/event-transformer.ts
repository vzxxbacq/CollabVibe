import type { EventMsg } from "../../../packages/agent-core/src/index";
import { parseDiffFileNames, parseDiffStats } from "../../../packages/git-utils/src/diff-parser";
import type { IMOutputMessage } from "./im-output";

export interface TransformContext {
  chatId: string;
  threadId: string;
  turnId: string;
  threadName?: string;
}

/** Extract first line of command, strip shell wrappers, truncate to max chars */
function truncateCommand(raw: string, max = 80): string {
  // Remove shell wrapper prefix: /bin/bash -lc bash -lc '...'
  let cmd = raw.replace(/^\/bin\/(?:ba)?sh\s+-\w+\s+(?:ba)?sh\s+-\w+\s+/g, "");
  // Take only the first line (strip heredoc body)
  cmd = cmd.split("\n")[0] ?? cmd;
  // Strip surrounding quotes
  cmd = cmd.replace(/^'(.*)'$/s, "$1").replace(/^"(.*)"$/s, "$1");
  // Remove heredoc marker: <<"PY" or <<'EOF' etc
  cmd = cmd.replace(/\s*<<["']?\w+["']?\s*$/, "");
  if (cmd.length > max) {
    cmd = cmd.slice(0, max - 3) + "...";
  }
  return cmd || raw.slice(0, max);
}

const FILTERED_EVENTS = new Set<string>([
  "session_configured",
  "mcp_startup_update",
  "mcp_startup_complete",
  "background_event",
  "shutdown_complete",
  "raw_response_item"
]);

type AnyEvent = EventMsg | { type: string;[key: string]: unknown };

function turnIdOf(event: AnyEvent, fallback: string): string {
  const turnId = (event as { turn_id?: unknown }).turn_id;
  return typeof turnId === "string" && turnId.length > 0 ? turnId : fallback;
}

function firstChangedFile(event: AnyEvent): string | undefined {
  const changes = (event as { changes?: Record<string, unknown> }).changes;
  if (!changes || typeof changes !== "object") {
    return undefined;
  }
  return Object.keys(changes)[0];
}

function toCollabLabel(event: AnyEvent): string {
  switch (event.type) {
    case "collab_agent_spawn_begin":
      return "启动子 agent";
    case "collab_agent_spawn_end":
      return "子 agent 已启动";
    case "collab_agent_interaction_begin":
      return "与子 agent 交互";
    case "collab_agent_interaction_end":
      return "子 agent 交互完成";
    case "collab_waiting_begin":
      return "等待子 agent";
    case "collab_waiting_end":
      return "子 agent 等待结束";
    case "collab_close_begin":
      return "关闭子 agent";
    case "collab_close_end":
      return "子 agent 已关闭";
    case "collab_resume_begin":
      return "恢复子 agent";
    case "collab_resume_end":
      return "子 agent 已恢复";
    default:
      return "子 agent 事件";
  }
}

function collabAgentId(event: AnyEvent): string | undefined {
  const candidates = [
    (event as { receiver_thread_id?: unknown }).receiver_thread_id,
    (event as { new_thread_id?: unknown }).new_thread_id,
    (event as { sender_thread_id?: unknown }).sender_thread_id
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

export function transformEvent(event: AnyEvent, ctx: TransformContext): IMOutputMessage | null {
  if (FILTERED_EVENTS.has(event.type)) {
    return null;
  }

  switch (event.type) {
    case "agent_message_content_delta":
      return {
        kind: "content",
        turnId: ctx.turnId,
        delta: String((event as { delta?: unknown }).delta ?? "")
      };
    case "agent_reasoning_delta":
    case "reasoning_content_delta":
    case "reasoning_raw_content_delta":
      return {
        kind: "reasoning",
        turnId: ctx.turnId,
        delta: String((event as { delta?: unknown }).delta ?? "")
      };
    case "plan_delta":
      return {
        kind: "plan",
        turnId: ctx.turnId,
        delta: String((event as { delta?: unknown }).delta ?? "")
      };
    case "plan_update":
      return {
        kind: "plan_update",
        turnId: turnIdOf(event, ctx.turnId),
        explanation: typeof (event as { explanation?: unknown }).explanation === "string"
          ? String((event as { explanation?: unknown }).explanation)
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
      // chunk 是 base64 编码的命令输出，需要解码
      const rawChunk = String((event as { chunk?: unknown }).chunk ?? "");
      let decoded: string;
      try {
        decoded = Buffer.from(rawChunk, "base64").toString("utf-8");
      } catch {
        decoded = rawChunk; // 如果解码失败，使用原始文本
      }
      // 去掉 ANSI 转义序列 (颜色/样式控制码)
      decoded = decoded.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
      return {
        kind: "tool_output",
        turnId: turnIdOf(event, ctx.turnId),
        callId: String((event as { call_id?: unknown }).call_id ?? "unknown"),
        delta: decoded,
        source: "stdout" as const
      };
    }
    case "terminal_interaction":
      return {
        kind: "tool_output",
        turnId: ctx.turnId,
        callId: String((event as { call_id?: unknown }).call_id ?? "stdin"),
        delta: String((event as { stdin?: unknown }).stdin ?? ""),
        source: "stdin" as const
      };
    case "exec_command_begin": {
      const cmdParts = ((event as { command?: string[] }).command ?? []).join(" ");
      const cmdLabel = truncateCommand(cmdParts);
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "begin",
        tool: "exec_command",
        label: cmdLabel,
        callId: String((event as { call_id?: unknown }).call_id ?? "")
      };
    }
    case "exec_command_end": {
      const cmdParts2 = ((event as { command?: string[] }).command ?? []).join(" ");
      const cmdLabel2 = truncateCommand(cmdParts2);
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "end",
        tool: "exec_command",
        label: cmdLabel2,
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        summary: (event as { aggregated_output?: string }).aggregated_output,
        status: (event as { status?: string }).status === "completed" ? "success" : "failed",
        exitCode: (event as { exit_code?: number }).exit_code,
        duration: (event as { duration?: string }).duration
      };
    }
    case "mcp_tool_call_begin":
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "begin",
        tool: "mcp_tool",
        label: `调用 MCP 工具: ${String((event as { invocation?: { tool?: unknown } }).invocation?.tool ?? "unknown")}`
      };
    case "mcp_tool_call_end":
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "end",
        tool: "mcp_tool",
        label: `MCP 工具完成: ${String((event as { invocation?: { tool?: unknown } }).invocation?.tool ?? "unknown")}`,
        status: (event as { result?: unknown }).result && "Err" in ((event as { result?: object }).result ?? {}) ? "failed" : "success",
        duration: (event as { duration?: string }).duration
      };
    case "dynamic_tool_call_request":
      return {
        kind: "progress",
        turnId: String((event as { turnId?: unknown }).turnId ?? ctx.turnId),
        phase: "begin",
        tool: "mcp_tool",
        label: `调用动态工具: ${String((event as { tool?: unknown }).tool ?? "unknown")}`
      };
    case "dynamic_tool_call_response":
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "end",
        tool: "mcp_tool",
        label: `动态工具完成: ${String((event as { tool?: unknown }).tool ?? "unknown")}`,
        status: (event as { success?: boolean }).success ? "success" : "failed",
        duration: (event as { duration?: string }).duration
      };
    case "web_search_begin":
      return {
        kind: "progress",
        turnId: ctx.turnId,
        phase: "begin",
        tool: "web_search",
        label: "执行 Web 搜索"
      };
    case "web_search_end":
      return {
        kind: "progress",
        turnId: ctx.turnId,
        phase: "end",
        tool: "web_search",
        label: `Web 搜索完成: ${String((event as { query?: unknown }).query ?? "")}`,
        status: "success"
      };
    case "image_generation_begin":
      return {
        kind: "progress",
        turnId: ctx.turnId,
        phase: "begin",
        tool: "image_gen",
        label: "生成图片"
      };
    case "image_generation_end":
      return {
        kind: "progress",
        turnId: ctx.turnId,
        phase: "end",
        tool: "image_gen",
        label: "图片生成完成",
        status: (event as { status?: string }).status === "success" ? "success" : "failed"
      };
    case "patch_apply_begin":
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "begin",
        tool: "patch_apply",
        label: "应用补丁",
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        targetFile: firstChangedFile(event)
      };
    case "patch_apply_end":
      return {
        kind: "progress",
        turnId: turnIdOf(event, ctx.turnId),
        phase: "end",
        tool: "patch_apply",
        label: "补丁应用完成",
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        summary: (event as { stdout?: string; stderr?: string }).stdout || (event as { stderr?: string }).stderr,
        status: (event as { success?: boolean }).success ? "success" : "failed",
        targetFile: firstChangedFile(event)
      };
    case "collab_agent_spawn_begin":
    case "collab_agent_spawn_end":
    case "collab_agent_interaction_begin":
    case "collab_agent_interaction_end":
    case "collab_waiting_begin":
    case "collab_waiting_end":
    case "collab_close_begin":
    case "collab_close_end":
    case "collab_resume_begin":
    case "collab_resume_end":
      return {
        kind: "progress",
        turnId: ctx.turnId,
        phase: event.type.endsWith("_begin") ? "begin" : "end",
        tool: "collab_agent",
        label: toCollabLabel(event),
        status: event.type.endsWith("_end") ? "success" : undefined,
        agentId: collabAgentId(event)
      };
    case "exec_approval_request":
      return {
        kind: "approval",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        threadName: ctx.threadName,
        approvalId: String((event as { approval_id?: unknown }).approval_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        approvalType: "command_exec",
        description: `审批命令：${((event as { command?: string[] }).command ?? []).join(" ")}`.trim(),
        createdAt: new Date().toISOString(),
        command: (event as { command?: string[] }).command ?? [],
        availableActions: ["approve", "deny", "approve_always"]
      };
    case "apply_patch_approval_request":
      return {
        kind: "approval",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        threadName: ctx.threadName,
        approvalId: String((event as { approval_id?: unknown }).approval_id ?? ""),
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        approvalType: "file_change",
        description: "审批文件变更",
        createdAt: new Date().toISOString(),
        changes: (event as { changes?: Record<string, unknown> }).changes ?? {},
        availableActions: ["approve", "deny", "approve_always"]
      };
    case "request_user_input":
      return {
        kind: "user_input",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        threadName: ctx.threadName,
        callId: String((event as { call_id?: unknown }).call_id ?? ""),
        questions: ((event as { questions?: Array<{ question?: string; options?: Array<{ label?: string }> }> }).questions ?? []).map((question) => ({
          text: String(question.question ?? ""),
          options: question.options?.map((opt) => String(opt.label ?? "")).filter((value) => value.length > 0)
        }))
      };
    case "elicitation_request":
      return {
        kind: "user_input",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        threadName: ctx.threadName,
        callId: String((event as { id?: unknown }).id ?? ""),
        questions: [
          {
            text: String((event as { request?: { message?: string } }).request?.message ?? "需要用户输入")
          }
        ]
      };
    case "task_started":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        category: "turn_started",
        title: "任务开始"
      };
    case "task_complete":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        category: "turn_complete",
        title: "任务完成",
        lastAgentMessage: (event as { last_agent_message?: string | null }).last_agent_message ?? undefined
      };
    case "turn_aborted":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: turnIdOf(event, ctx.turnId),
        category: "turn_aborted",
        title: "任务中断"
      };
    case "warning":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "warning",
        title: String((event as { message?: unknown }).message ?? "warning")
      };
    case "error":
    case "stream_error":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "error",
        title: String((event as { message?: unknown }).message ?? "error")
      };
    case "token_count":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "token_usage",
        title: "Token 用量",
        tokenUsage: {
          input: Number((event as { info?: { last_token_usage?: { input_tokens?: number } } }).info?.last_token_usage?.input_tokens ?? 0),
          output: Number((event as { info?: { last_token_usage?: { output_tokens?: number } } }).info?.last_token_usage?.output_tokens ?? 0)
        }
      };
    case "model_reroute":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "model_reroute",
        title: "模型已切换",
        detail: `${String((event as { from_model?: unknown }).from_model ?? "")} -> ${String((event as { to_model?: unknown }).to_model ?? "")}`.trim()
      };
    case "context_compacted":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "context_compacted",
        title: "上下文已压缩"
      };
    case "undo_started":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "undo_started",
        title: String((event as { message?: string | null }).message ?? "开始回滚")
      };
    case "undo_completed":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "undo_completed",
        title: String((event as { message?: string | null }).message ?? "回滚完成"),
        detail: (event as { success?: boolean }).success ? "success" : "failed"
      };
    case "deprecation_notice":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "deprecation",
        title: String((event as { summary?: unknown }).summary ?? "能力弃用通知"),
        detail: String((event as { details?: unknown }).details ?? "")
      };
    case "agent_message":
      return {
        kind: "notification",
        threadId: ctx.threadId,
        turnId: ctx.turnId,
        category: "agent_message",
        title: "Agent 回复",
        lastAgentMessage: String((event as { message?: unknown }).message ?? "")
      };
    default:
      return null;
  }
}
