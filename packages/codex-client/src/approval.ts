import type { EventMsg } from "./generated/EventMsg";

export type ApprovalRequestType = "command_exec" | "file_change";
export type ApprovalDecision = "accept" | "decline" | "approve_always";

export interface ApprovalRequestEvent {
  type: ApprovalRequestType;
  requestId: string;
  callId: string;
  turnId: string;
  description: string;
  command?: string[];
  changes?: Record<string, unknown>;
}

type RawApprovalEvent = Partial<EventMsg> & {
  type?: string;
  method?: string;
  call_id?: string;
  callId?: string;
  turn_id?: string;
  turnId?: string;
  approval_id?: string;
  approvalId?: string;
  command?: string[];
  changes?: Record<string, unknown>;
};

function getString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeRequestId(event: RawApprovalEvent): string | null {
  return getString(event.approval_id) ?? getString(event.approvalId) ?? getString(event.call_id) ?? getString(event.callId);
}

function normalizeCallId(event: RawApprovalEvent): string | null {
  return getString(event.call_id) ?? getString(event.callId);
}

function normalizeTurnId(event: RawApprovalEvent): string | null {
  return getString(event.turn_id) ?? getString(event.turnId);
}

function normalizeType(event: RawApprovalEvent): ApprovalRequestType | null {
  const kind = event.type ?? event.method;
  if (kind === "exec_approval_request" || kind === "item/commandExecution/requestApproval") {
    return "command_exec";
  }
  if (kind === "apply_patch_approval_request" || kind === "item/fileChange/requestApproval") {
    return "file_change";
  }
  return null;
}

function normalizeCommand(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  if (!value.every((part) => typeof part === "string" && part.length > 0)) {
    return null;
  }
  return value;
}

function normalizeChanges(value: unknown): Record<string, unknown> | null {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseApprovalRequestEvent(input: unknown): ApprovalRequestEvent | null {
  if (typeof input !== "object" || input === null) {
    return null;
  }

  const event = input as RawApprovalEvent;
  const type = normalizeType(event);
  if (!type) {
    return null;
  }

  const callId = normalizeCallId(event);
  const turnId = normalizeTurnId(event);
  const requestId = normalizeRequestId(event);
  if (!callId || !turnId || !requestId) {
    return null;
  }

  if (type === "command_exec") {
    const command = normalizeCommand(event.command);
    if (!command) {
      return null;
    }
    return {
      type,
      requestId,
      callId,
      turnId,
      description: `Command approval requested: ${command.join(" ")}`.trim(),
      command
    };
  }

  const changes = normalizeChanges(event.changes);
  if (!changes) {
    return null;
  }
  return {
    type,
    requestId,
    callId,
    turnId,
    description: "File change approval requested",
    changes
  };
}

export function toProtocolDecision(decision: ApprovalDecision): "approved" | "denied" | "approved_for_session" {
  if (decision === "accept") {
    return "approved";
  }
  if (decision === "decline") {
    return "denied";
  }
  if (decision === "approve_always") {
    return "approved_for_session";
  }
  throw new Error(`invalid approval decision: ${String(decision)}`);
}
