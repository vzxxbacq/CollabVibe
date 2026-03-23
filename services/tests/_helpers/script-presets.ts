/**
 * Predefined BackendScriptStep[] sequences for common test scenarios.
 * Avoids repeating event boilerplate across sim tests.
 */
import type { BackendScriptStep } from "./scripted-backend";

// ── Simple turn: start → content → complete ─────────────────────────────────

export const SIMPLE_TURN_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "started" } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "hello world" } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "hello world" } },
];

// ── Reasoning + content interleaved ─────────────────────────────────────────

export const REASONING_CONTENT_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "thinking" } },
  { type: "event", event: { type: "reasoning_delta", turnId: "t-1", delta: "let me think..." } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "I've decided" } },
  { type: "event", event: { type: "reasoning_delta", turnId: "t-1", delta: "actually reconsider" } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "final answer" } },
  { type: "event", event: { type: "token_usage", turnId: "t-1", input: 100, output: 50, total: 150 } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "final answer" } },
];

// ── Tool use: begin → output → end ──────────────────────────────────────────

export const TOOL_USE_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "running" } },
  { type: "event", event: { type: "tool_begin", turnId: "t-1", tool: "exec_command", label: "ls -la", callId: "call-tool-1" } },
  { type: "event", event: { type: "tool_output", turnId: "t-1", callId: "call-tool-1", delta: "file1.ts\nfile2.ts", source: "stdout" } },
  { type: "event", event: { type: "tool_end", turnId: "t-1", tool: "exec_command", label: "ls -la", callId: "call-tool-1", status: "success", exitCode: 0 } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "found 2 files" } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "found 2 files" } },
];

// ── Approval flow ───────────────────────────────────────────────────────────

export function approvalScript(approvalId: string, callId = "call-appr"): BackendScriptStep[] {
  return [
    { type: "event", event: { type: "turn_started", turnId: "t-1", title: "needs approval" } },
    { type: "event", event: { type: "approval_request", turnId: "t-1", approvalId, callId, approvalType: "command_exec", description: "run dangerous command" } },
    { type: "wait_approval", approvalId },
    { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "continued after approval" } },
    { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "approved done" } },
  ];
}

// ── User input flow ─────────────────────────────────────────────────────────

export function userInputScript(callId: string, questions = [{ id: "q1", text: "pick one", options: ["A", "B"] }]): BackendScriptStep[] {
  return [
    { type: "event", event: { type: "turn_started", turnId: "t-1", title: "needs input" } },
    { type: "event", event: { type: "user_input", turnId: "t-1", callId, questions } },
    { type: "wait_user_input", callId },
    { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "input received" } },
    { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "input done" } },
  ];
}

// ── Notification-only turn ──────────────────────────────────────────────────

export const NOTIFICATION_ONLY_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "notice" } },
  { type: "event", event: { type: "notification", turnId: "t-1", category: "agent_message", title: "heads up" } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "noted" } },
];

// ── Plan mode: plan_delta + plan_update ──────────────────────────────────────

export const PLAN_MODE_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "planning" } },
  { type: "event", event: { type: "plan_delta", turnId: "t-1", delta: "Step 1: analyze" } },
  { type: "event", event: { type: "plan_update", turnId: "t-1", plan: [{ step: "analyze", status: "completed" }, { step: "implement", status: "pending" }] } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "plan ready" } },
];

// ── Token usage multiple updates ────────────────────────────────────────────

export const MULTI_TOKEN_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "started" } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "part 1" } },
  { type: "event", event: { type: "token_usage", turnId: "t-1", input: 50, output: 20 } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "part 2" } },
  { type: "event", event: { type: "token_usage", turnId: "t-1", input: 100, output: 50, total: 150 } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "part 2" } },
];

// ── Aborted turn ────────────────────────────────────────────────────────────

export const ABORTED_TURN_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "started" } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "working..." } },
  { type: "event", event: { type: "turn_aborted", turnId: "t-1", title: "interrupted" } },
];

// ── Error notification ──────────────────────────────────────────────────────

export const ERROR_TURN_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "started" } },
  { type: "event", event: { type: "notification", turnId: "t-1", category: "error", title: "backend crash" } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "failed" } },
];

// ── Multiple tool calls ─────────────────────────────────────────────────────

export const MULTI_TOOL_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "multi-tool" } },
  { type: "event", event: { type: "tool_begin", turnId: "t-1", tool: "exec_command", label: "ls", callId: "call-mt-1" } },
  { type: "event", event: { type: "tool_output", turnId: "t-1", callId: "call-mt-1", delta: "file1.ts", source: "stdout" } },
  { type: "event", event: { type: "tool_end", turnId: "t-1", tool: "exec_command", label: "ls", callId: "call-mt-1", status: "success", exitCode: 0 } },
  { type: "event", event: { type: "tool_begin", turnId: "t-1", tool: "patch_apply", label: "write file2.ts", callId: "call-mt-2" } },
  { type: "event", event: { type: "tool_output", turnId: "t-1", callId: "call-mt-2", delta: "wrote 50 lines", source: "stdout" } },
  { type: "event", event: { type: "tool_end", turnId: "t-1", tool: "patch_apply", label: "write file2.ts", callId: "call-mt-2", status: "success", exitCode: 0 } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "used 2 tools" } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "used 2 tools" } },
];

// ── File change approval ────────────────────────────────────────────────────

export function fileChangeApprovalScript(approvalId: string, callId = "call-fc"): BackendScriptStep[] {
  return [
    { type: "event", event: { type: "turn_started", turnId: "t-1", title: "file change" } },
    { type: "event", event: { type: "approval_request", turnId: "t-1", approvalId, callId, approvalType: "file_change", description: "modify config.ts" } },
    { type: "wait_approval", approvalId },
    { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "file changed" } },
    { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "file changed" } },
  ];
}

// ── Long content ────────────────────────────────────────────────────────────

export const LONG_CONTENT_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "long" } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "A".repeat(5000) } },
  { type: "event", event: { type: "content_delta", turnId: "t-1", delta: "B".repeat(5000) } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "long content done" } },
];

// ── Empty turn (start → complete, no content) ───────────────────────────────

export const EMPTY_TURN_SCRIPT: BackendScriptStep[] = [
  { type: "event", event: { type: "turn_started", turnId: "t-1", title: "empty" } },
  { type: "event", event: { type: "turn_complete", turnId: "t-1", lastAgentMessage: "" } },
];
