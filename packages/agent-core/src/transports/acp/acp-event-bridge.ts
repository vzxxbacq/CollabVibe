import { Buffer } from "node:buffer";
import { parseDiffFileNames, parseDiffStats } from "../../../../git-utils/src/diff-parser";
import { buildApprovalDisplay, nonEmptyString, summarizeText } from "../../approval-display";
import type { UnifiedAgentEvent, UnifiedAgentTool } from "../../unified-agent-event";

import { createApprovalOptionMapper } from "./approval-option-mapper";
import type { AcpSessionUpdate } from "./types";

const mapper = createApprovalOptionMapper();

export interface AcpEventFilterOptions {
  ignorePromptResponseCompletion?: boolean;
}

function buildAcpApprovalDisplay(update: AcpSessionUpdate): {
  displayName?: string;
  summary?: string;
  reason?: string;
  cwd?: string;
  description: string;
} {
  const requestId = nonEmptyString(update.requestId);
  const callId = nonEmptyString(update.toolCallId ?? update.callId);
  const titleCandidate = nonEmptyString(update.title)
    ?? nonEmptyString(update.label)
    ?? nonEmptyString(update.name);
  const description = nonEmptyString(update.description);
  const command = nonEmptyString((update.rawInput as Record<string, unknown> | undefined)?.command);
  const cwd = nonEmptyString((update.rawInput as Record<string, unknown> | undefined)?.cwd ?? update.cwd);
  const reason = description;
  const approvalType = normalizeApprovalType(update.permissionKind);
  return buildApprovalDisplay({
    approvalType,
    requestId,
    callId,
    description,
    reason,
    cwd,
    displayNameCandidates: [titleCandidate],
    summaryCandidates: [command, summarizeText(description?.split("\n")[0])],
    fallbackDisplayName: approvalType === "file_change" ? "Approve file changes" : "Run shell command",
    fallbackDescription: approvalType === "file_change" ? "File change approval" : "Approval required"
  });
}

/**
 * Creates a stateful event filter that tracks `<think>` tags across streamed chunks.
 * Content between `<think>` and `</think>` is rerouted as `reasoning_delta`.
 */
export function createAcpEventFilter(options: AcpEventFilterOptions = {}): (update: AcpSessionUpdate) => UnifiedAgentEvent[] {
  let insideThink = false;

  return (update: AcpSessionUpdate): UnifiedAgentEvent[] => {
    // opencode sends event type in 'sessionUpdate' field, fallback to 'type'
    const eventType = String(update.sessionUpdate ?? update.type ?? "");

    if (eventType === "agent_message_chunk") {
      const content = update.content as { text?: string } | string | undefined;
      let text = typeof content === "object" && content !== null ? String(content.text ?? "") : String(content ?? update.delta ?? "");

      // Handle <think> tags: split and route accordingly
      // We collect ALL text segments and merge by type
      let reasoningBuf = "";
      let contentBuf = "";

      while (text.length > 0) {
        if (!insideThink) {
          const thinkStart = text.indexOf("<think>");
          if (thinkStart === -1) {
            contentBuf += text;
            break;
          }
          if (thinkStart > 0) {
            contentBuf += text.substring(0, thinkStart);
          }
          insideThink = true;
          text = text.substring(thinkStart + 7);
        } else {
          const thinkEnd = text.indexOf("</think>");
          if (thinkEnd === -1) {
            reasoningBuf += text;
            break;
          }
          if (thinkEnd > 0) {
            reasoningBuf += text.substring(0, thinkEnd);
          }
          insideThink = false;
          text = text.substring(thinkEnd + 8);
        }
      }

      // Emit reasoning first (if any), queue content for the caller to get via
      // the adapter's event loop. But since caller processes one event per update,
      // we need to return both. Use a simple strategy: if both exist, return
      // reasoning and push content to pending. Next call will drain pending first.
      const events: UnifiedAgentEvent[] = [];
      if (reasoningBuf.trim().length > 0) events.push({ type: "reasoning_delta", delta: reasoningBuf });
      if (contentBuf.trim().length > 0) events.push({ type: "content_delta", delta: contentBuf });
      return events;
    }

    // For all other event types, delegate to stateless handler
    const evt = acpEventToUnifiedAgentEvent(update, options);
    return evt ? [evt] : [];
  };
}

export function acpEventToUnifiedAgentEvent(update: AcpSessionUpdate, options: AcpEventFilterOptions = {}): UnifiedAgentEvent | null {
  // opencode sends event type in 'sessionUpdate' field, fallback to 'type'
  const eventType = String(update.sessionUpdate ?? update.type ?? "");
  switch (eventType) {
    case "agent_message_chunk": {
      const content = update.content as { text?: string } | string | undefined;
      const text = typeof content === "object" && content !== null ? String(content.text ?? "") : String(content ?? update.delta ?? "");
      return { type: "content_delta", delta: text };
    }
    case "agent_thought_chunk": {
      const content = update.content as { text?: string } | string | undefined;
      const text = typeof content === "object" && content !== null ? String(content.text ?? "") : String(content ?? update.delta ?? "");
      return { type: "reasoning_delta", delta: text };
    }
    case "plan":
      return { type: "plan_delta", delta: String(update.delta ?? update.content ?? JSON.stringify(update)) };
    case "tool_call":
      return {
        type: "tool_begin",
        callId: String(update.toolCallId ?? update.callId ?? ""),
        tool: normalizeTool(update.kind),
        label: String(update.title ?? update.label ?? update.name ?? update.kind ?? "tool")
      };
    case "tool_call_update": {
      const status = String(update.status ?? "");
      const callId = String(update.toolCallId ?? update.callId ?? "");
      const tool = normalizeTool(update.kind);
      const label = String(update.title ?? update.label ?? update.name ?? update.kind ?? "tool");

      // Extract text from opencode's nested content array:
      // content: [{ type: "content", content: { type: "text", text: "..." } }]
      const extractContent = (): string => {
        const c = update.content;
        if (Array.isArray(c)) {
          return c.map((item: Record<string, unknown>) => {
            const inner = item.content as { text?: string } | undefined;
            return inner?.text ?? String(item.text ?? "");
          }).filter(Boolean).join("\n");
        }
        if (typeof c === "string") return c;
        if (typeof c === "object" && c !== null) return String((c as { text?: string }).text ?? "");
        return "";
      };

      if (status === "completed") {
        const text = extractContent();
        // Return tool_output with the result content; tool_end will be sent by the caller
        // We use tool_end here and include the output — the Feishu adapter will render it
        return {
          type: "tool_end",
          callId,
          tool,
          label,
          status: "success",
          output: text || undefined
        };
      }

      // For in_progress: try to extract actual content for display
      const progressText = extractContent();
      if (progressText) {
        return {
          type: "tool_output",
          callId,
          delta: progressText,
          source: "stdout",
          format: "text",
          byteLength: Buffer.byteLength(progressText, "utf8")
        };
      }

      // Also handle rawInput for showing what command/file is being operated on
      const rawInput = update.rawInput as Record<string, string> | undefined;
      if (rawInput) {
        const inputSummary = rawInput.command ?? rawInput.pattern ?? rawInput.path ?? "";
        if (inputSummary) {
          return {
            type: "tool_output",
            callId,
            delta: inputSummary,
            source: "stdout",
            format: "text",
            byteLength: Buffer.byteLength(inputSummary, "utf8")
          };
        }
      }

      if (update.contentType === "terminal") {
        const delta = String(update.delta ?? update.content ?? "");
        return {
          type: "tool_output",
          callId,
          delta,
          source: "stdout",
          format: "text",
          byteLength: Buffer.byteLength(delta, "utf8")
        };
      }
      // No content to show — skip
      return null;
    }
    case "requestPermission":
    case "request_permission": {
      const options = Array.isArray(update.options) ? update.options as Array<{ id?: unknown }> : [];
      const availableActions = options
        .map((option) => typeof option.id === "string" ? mapper.toImAction(option.id) : null)
        .filter(Boolean) as Array<"approve" | "deny" | "approve_always">;
      const display = buildAcpApprovalDisplay(update);
      return {
        type: "approval_request",
        approvalId: String(update.requestId ?? update.toolCallId ?? update.callId ?? ""),
        turnId: String(update.turnId ?? ""),
        callId: String(update.toolCallId ?? update.callId ?? ""),
        approvalType: normalizeApprovalType(update.permissionKind),
        description: display.description,
        displayName: display.displayName,
        summary: display.summary,
        reason: display.reason,
        cwd: display.cwd,
        availableActions: availableActions.length > 0 ? [...new Set(availableActions)] : ["deny"],
        backendType: "acp"
      };
    }
    case "prompt_response":
      if (options.ignorePromptResponseCompletion) {
        return null;
      }
      if (update.stopReason === "end_turn") {
        return { type: "turn_complete", lastAgentMessage: typeof update.lastAgentMessage === "string" ? update.lastAgentMessage : undefined };
      }
      if (update.stopReason === "cancelled") {
        return { type: "turn_aborted" };
      }
      return null;
    case "available_commands_update":
      // Informational only — no UI action needed
      return null;
    default:
      return null;
  }
}

function normalizeTool(kind: unknown): UnifiedAgentTool {
  switch (String(kind ?? "")) {
    case "execute":
      return "exec_command";
    case "edit":
      return "patch_apply";
    case "read":
    case "search":
    case "fetch":
      return "mcp_tool";
    default:
      return "mcp_tool";
  }
}

function normalizeApprovalType(kind: unknown): "command_exec" | "file_change" {
  return String(kind ?? "").includes("file") ? "file_change" : "command_exec";
}
