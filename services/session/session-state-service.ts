import { ApprovalWaitManager, ConversationStateMachine } from "./state-machine";
import { TurnStateManager } from "./turn-state-manager";

export type ProjectThreadKey = string;

export function projectThreadKey(projectId: string, threadName: string): ProjectThreadKey {
  return `${projectId}:${threadName}`;
}

/**
 * SessionStateService — centralises per-project-thread runtime state
 * that was previously scattered across three `Map`s inside orchestrator.ts.
 *
 * Owns:
 *   • ConversationStateMachine instances (IDLE / RUNNING / AWAITING_APPROVAL / …)
 *   • ApprovalWaitManager instances (approval timeout tracking)
 *   • TurnStateManager (transient pending-approval contexts)
 */
export class SessionStateService {
  private readonly machines = new Map<ProjectThreadKey, ConversationStateMachine>();
  private readonly approvalManagers = new Map<ProjectThreadKey, ApprovalWaitManager>();
  private readonly interruptingTurns = new Map<ProjectThreadKey, string>();
  readonly turnState: TurnStateManager;

  constructor(private readonly approvalTimeoutMs: number) {
    this.turnState = new TurnStateManager(approvalTimeoutMs);
  }

  /* ── accessors ── */

  getStateMachine(key: ProjectThreadKey): ConversationStateMachine {
    let existing = this.machines.get(key);
    if (!existing) {
      existing = new ConversationStateMachine();
      this.machines.set(key, existing);
    }
    return existing;
  }

  getApprovalWaitManager(key: ProjectThreadKey): ApprovalWaitManager {
    let existing = this.approvalManagers.get(key);
    if (!existing) {
      existing = new ApprovalWaitManager({ timeoutMs: this.approvalTimeoutMs });
      this.approvalManagers.set(key, existing);
    }
    return existing;
  }

  /* ── state transitions ── */

  ensureCanStartTurn(key: ProjectThreadKey, options?: { allowConcurrentRunning?: boolean }): void {
    const machine = this.getStateMachine(key);
    const state = machine.getState();
    if (state === "AWAITING_APPROVAL") {
      throw new Error("approval pending: wait for approval decision before sending more messages");
    }
    if (state === "INTERRUPTING") {
      throw new Error("turn is interrupting: wait for the current turn to abort before sending more messages");
    }
    if (state === "INTERRUPTED") {
      throw new Error("turn interrupt is still being finalized: please retry in a moment");
    }
    if (state === "RUNNING" && !options?.allowConcurrentRunning) {
      throw new Error("turn already running: wait for current turn to finish");
    }
    if (state !== "RUNNING") {
      machine.transition("RUNNING");
    }
  }

  finishSessionTurn(key: ProjectThreadKey): void {
    const machine = this.getStateMachine(key);
    if (machine.getState() === "RUNNING") {
      machine.transition("IDLE");
    }
  }

  releaseFailedStartTurn(key: ProjectThreadKey): void {
    const machine = this.getStateMachine(key);
    const state = machine.getState();
    if (state === "RUNNING") {
      machine.transition("FAILED");
      machine.transition("IDLE");
      return;
    }
    if (state === "FAILED") {
      machine.transition("IDLE");
    }
  }

  /* ── bulk cleanup ── */

  /** Release all state machines and approval managers whose key starts with the given prefix. */
  releaseByPrefix(prefix: string): void {
    for (const key of this.machines.keys()) {
      if (key.startsWith(`${prefix}:`)) {
        this.machines.delete(key);
        this.approvalManagers.delete(key);
        this.interruptingTurns.delete(key);
      }
    }
  }

  beginInterrupt(key: ProjectThreadKey, turnId: string): void {
    const machine = this.getStateMachine(key);
    if (machine.getState() === "RUNNING" || machine.getState() === "AWAITING_APPROVAL") {
      machine.transition("INTERRUPTING");
    }
    this.interruptingTurns.set(key, turnId);
  }

  getInterruptingTurnId(key: ProjectThreadKey): string | null {
    return this.interruptingTurns.get(key) ?? null;
  }

  isInterruptingTurn(key: ProjectThreadKey, turnId: string): boolean {
    return this.interruptingTurns.get(key) === turnId;
  }

  completeInterrupt(key: ProjectThreadKey, turnId: string): boolean {
    if (this.interruptingTurns.get(key) !== turnId) {
      return false;
    }
    const machine = this.getStateMachine(key);
    if (machine.getState() === "INTERRUPTING") {
      machine.transition("INTERRUPTED");
    }
    this.interruptingTurns.delete(key);
    if (machine.getState() === "INTERRUPTED") {
      machine.transition("IDLE");
    }
    return true;
  }

  clearInterrupt(key: ProjectThreadKey): void {
    this.interruptingTurns.delete(key);
    const machine = this.getStateMachine(key);
    if (machine.getState() === "INTERRUPTED") {
      machine.transition("IDLE");
    }
  }

  hasPendingApproval(key: ProjectThreadKey): boolean {
    return this.turnState.hasPendingApprovalForThread(key);
  }

  /* ── raw map access ── */

  get sessionStateMachines(): Map<ProjectThreadKey, ConversationStateMachine> {
    return this.machines;
  }

  get sessionApprovalWaitManagers(): Map<ProjectThreadKey, ApprovalWaitManager> {
    return this.approvalManagers;
  }
}
