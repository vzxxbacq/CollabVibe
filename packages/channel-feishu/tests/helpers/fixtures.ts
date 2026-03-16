import type {
  IMApprovalRequest,
  IMNotification,
  IMProgressEvent,
  IMTurnSummary,
  IMUserInputRequest
} from "../../../channel-core/src/index";

export function buildNotification(overrides: Partial<IMNotification> = {}): IMNotification {
  return {
    kind: "notification",
    threadId: "thr-1",
    turnId: "turn-1",
    category: "turn_started",
    title: "开始",
    ...overrides
  };
}

export function buildTurnSummary(overrides: Partial<IMTurnSummary> = {}): IMTurnSummary {
  return {
    kind: "turn_summary",
    threadId: "thr-1",
    turnId: "turn-1",
    filesChanged: [],
    ...overrides
  };
}

export function buildApprovalRequest(overrides: Partial<IMApprovalRequest> = {}): IMApprovalRequest {
  return {
    kind: "approval",
    threadId: "thr-1",
    turnId: "turn-approval",
    approvalId: "approval-1",
    callId: "call-1",
    approvalType: "command_exec",
    description: "approve this command",
    availableActions: ["approve", "deny", "approve_always"],
    ...overrides
  };
}

export function buildUserInputRequest(overrides: Partial<IMUserInputRequest> = {}): IMUserInputRequest {
  return {
    kind: "user_input",
    threadId: "thr-1",
    turnId: "turn-user-input",
    callId: "input-1",
    questions: [{ text: "请选择部署环境" }],
    ...overrides
  };
}

export function buildProgressEvent(overrides: Partial<IMProgressEvent> = {}): IMProgressEvent {
  return {
    kind: "progress",
    turnId: "turn-1",
    phase: "begin",
    tool: "exec_command",
    label: "npm test",
    ...overrides
  };
}
