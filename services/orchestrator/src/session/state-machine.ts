import { OrchestratorError, ErrorCode } from "../errors";

export type ConversationState = "IDLE" | "RUNNING" | "AWAITING_APPROVAL" | "INTERRUPTED" | "FAILED";

const ALLOWED_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  IDLE: ["RUNNING", "FAILED"],
  RUNNING: ["IDLE", "AWAITING_APPROVAL", "INTERRUPTED", "FAILED"],
  AWAITING_APPROVAL: ["RUNNING", "INTERRUPTED", "FAILED"],
  INTERRUPTED: ["IDLE", "RUNNING", "FAILED"],
  FAILED: ["IDLE", "RUNNING"]
};

export class ConversationStateMachine {
  private state: ConversationState = "IDLE";

  getState(): ConversationState {
    return this.state;
  }

  transition(next: ConversationState): ConversationState {
    const allowed = ALLOWED_TRANSITIONS[this.state];
    if (!allowed.includes(next)) {
      throw new OrchestratorError(ErrorCode.ILLEGAL_TRANSITION, `illegal transition ${this.state} -> ${next}`);
    }
    this.state = next;
    return this.state;
  }
}

export interface ApprovalWaitConfig {
  timeoutMs: number;
  now?: () => number;
}

interface PendingApproval {
  expiresAt: number;
  resolved: boolean;
  timer: NodeJS.Timeout;
  cleanupTimer?: NodeJS.Timeout;
}

export class ApprovalWaitManager {
  private readonly timeoutMs: number;

  private readonly now: () => number;

  private readonly pending = new Map<string, PendingApproval>();

  constructor(config: ApprovalWaitConfig) {
    this.timeoutMs = config.timeoutMs;
    this.now = config.now ?? (() => Date.now());
  }

  waitFor(
    approvalId: string,
    onTimeout: (approvalId: string) => void
  ): { approvalId: string; expiresAt: number } {
    const existing = this.pending.get(approvalId);
    if (existing) {
      return { approvalId, expiresAt: existing.expiresAt };
    }
    const expiresAt = this.now() + this.timeoutMs;
    const timer = setTimeout(() => {
      this.pending.delete(approvalId);
      onTimeout(approvalId);
    }, this.timeoutMs);
    this.pending.set(approvalId, {
      expiresAt,
      resolved: false,
      timer
    });
    return { approvalId, expiresAt };
  }

  decide(approvalId: string): { status: "resolved" | "duplicate" } {
    const pending = this.pending.get(approvalId);
    if (!pending) {
      throw new Error(`invalid approval id: ${approvalId}`);
    }
    if (pending.resolved) {
      return { status: "duplicate" };
    }
    pending.resolved = true;
    clearTimeout(pending.timer);
    pending.cleanupTimer = setTimeout(() => {
      this.pending.delete(approvalId);
    }, this.timeoutMs);
    return { status: "resolved" };
  }
}
