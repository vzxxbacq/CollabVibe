export interface ApprovalDecision {
  approvalId: string;
  approverId: string;
  action: "approve" | "deny" | "approve_always";
  projectId?: string;
  threadId?: string;
  turnId?: string;
  approvalType?: "command_exec" | "file_change";
}

export interface ApprovalDecisionStore {
  save(decision: ApprovalDecision): Promise<void>;
}

export interface ApprovalDecisionBridge {
  applyDecision(approvalId: string, action: ApprovalDecision["action"]): Promise<"resolved" | "duplicate" | void>;
}

export interface PendingApprovalContext {
  projectThreadKey: string;
  projectId: string;
  userId?: string;
  threadId: string;
  threadName: string;
  turnId: string;
  callId: string;
  approvalType: "command_exec" | "file_change";
}
