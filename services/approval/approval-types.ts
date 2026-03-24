export interface ApprovalDecision {
  approvalId: string;
  approverId: string;
  action: "approve" | "deny" | "approve_always";
  projectId?: string;
  threadId?: string;
  turnId?: string;
  approvalType?: "command_exec" | "file_change";
}

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "denied"
  | "approved_always"
  | "expired";

export interface ApprovalDecisionStore {
  create(record: ApprovalRecord): Promise<void>;
  markResolved(decision: ApprovalDecision): Promise<ApprovalRecord | null>;
  markExpired(approvalId: string, expiredAt?: string, reason?: string): Promise<ApprovalRecord | null>;
  expirePending(projectIds?: string[], reason?: string, expiredAt?: string): Promise<number>;
  getById(approvalId: string): Promise<ApprovalRecord | null>;
}

export interface ApprovalDecisionBridge {
  applyDecision(approvalId: string, action: ApprovalDecision["action"]): Promise<"resolved" | "duplicate" | void>;
}

export interface ApprovalDisplaySnapshot {
  threadName: string;
  displayName?: string;
  summary?: string;
  reason?: string;
  cwd?: string;
  description: string;
  files?: string[];
  createdAt: string;
}

export interface ApprovalCallbackDisplayResult {
  status: "resolved" | "duplicate" | "expired" | "invalid";
  approval?: ApprovalDisplaySnapshot & {
    threadId: string;
    approvalType: "command_exec" | "file_change";
    decision: ApprovalDecision["action"];
    actorId: string;
    resolvedAt: string;
    statusReason?: string;
    expiredAt?: string;
  };
}

export interface ApprovalRecord {
  approvalId: string;
  backendApprovalId: string;
  projectId: string;
  threadId: string;
  threadName: string;
  turnId: string;
  callId: string;
  approvalType: "command_exec" | "file_change";
  status: ApprovalStatus;
  actorId?: string;
  decision?: ApprovalDecision["action"];
  statusReason?: string;
  createdAt: string;
  resolvedAt?: string;
  expiredAt?: string;
  display: ApprovalDisplaySnapshot;
}

export interface PendingApprovalContext {
  approvalId: string;
  backendApprovalId: string;
  projectThreadKey: string;
  projectId: string;
  userId?: string;
  threadId: string;
  threadName: string;
  turnId: string;
  callId: string;
  approvalType: "command_exec" | "file_change";
  display: ApprovalDisplaySnapshot;
  status?: ApprovalStatus;
  statusReason?: string;
  resolvedAt?: string;
  expiredAt?: string;
  resolution?: "approve" | "deny" | "approve_always";
}
