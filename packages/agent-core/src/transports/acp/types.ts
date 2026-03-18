import type { UnifiedAgentEvent } from "../../unified-agent-event";

export interface AcpSessionRef {
  id: string;
}

export interface AcpTurnRef {
  id: string;
}

export interface AcpSessionUpdate {
  type?: string;
  [key: string]: unknown;
}

export interface AcpNotificationEnvelope {
  method: string;
  params: Record<string, unknown>;
}

export interface AcpPermissionOption {
  id: string;
  label?: string;
}

export interface AcpApprovalMapping {
  toImAction(optionId: string): "approve" | "deny" | "approve_always" | null;
  toOptionId(action: "approve" | "deny" | "approve_always"): string | null;
}

export interface AcpEventSource {
  onNotification(handler: (event: UnifiedAgentEvent) => void): void;
}
