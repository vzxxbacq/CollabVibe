import type { BackendIdentity } from "../../../../packages/agent-core/src/backend-identity";
import type { TurnStatus } from "../turn-state/turn-record";
import type { ThreadListEntry, ThreadRegistry, ThreadRecord, ThreadReservation } from "./thread-registry";
import type { ThreadTurnState } from "./thread-turn-state";
import type { ThreadTurnStateRepository } from "./thread-turn-state-repository";
import type { UserThreadBinding } from "./user-thread-binding-types";
import type { UserThreadBindingService } from "./user-thread-binding-service";

export class ThreadService {
  constructor(
    private readonly threadRegistry: ThreadRegistry,
    private readonly userThreadBindingService: UserThreadBindingService,
    private readonly threadTurnStateRepository: ThreadTurnStateRepository,
    private readonly nowIso: () => string,
    private readonly lookupTurnStatusSync?: (projectId: string, turnId: string) => TurnStatus | undefined,
  ) {}

  reserve(record: Omit<ThreadRecord, "threadId">): ThreadReservation {
    return this.threadRegistry.reserve(record);
  }

  activate(reservationId: string, record: ThreadRecord): void {
    this.threadRegistry.activate(reservationId, record);
  }

  release(reservationId: string): void {
    this.threadRegistry.release(reservationId);
  }

  register(record: ThreadRecord): void {
    this.threadRegistry.register(record);
  }

  getRecord(projectId: string, threadName: string): ThreadRecord | null {
    return this.threadRegistry.get(projectId, threadName);
  }

  listRecords(projectId: string): ThreadRecord[] {
    return this.threadRegistry.list(projectId);
  }

  listEntries(projectId: string): ThreadListEntry[] {
    const entries = this.threadRegistry.listEntries?.(projectId);
    if (entries) return entries;
    return this.threadRegistry.list(projectId).map((record) => ({
      projectId,
      chatId: record.chatId,
      threadName: record.threadName,
      threadId: record.threadId,
      status: "active" as const,
      backend: record.backend,
    }));
  }

  listAllRecords(): ThreadRecord[] {
    return this.threadRegistry.listAll?.() ?? [];
  }

  markMerged(projectId: string, threadName: string): void {
    this.threadRegistry.remove(projectId, threadName);
  }

  async reinitializeEmptyThread(params: {
    projectId: string;
    threadName: string;
    oldThreadId: string;
    newThreadId: string;
    chatId?: string;
    backend: BackendIdentity;
  }): Promise<void> {
    if (!this.threadRegistry.replaceEmptyThreadId) {
      throw new Error("ThreadRegistry.replaceEmptyThreadId is not available");
    }
    this.threadRegistry.replaceEmptyThreadId(params);
    await this.userThreadBindingService.rebindThread(
      params.projectId,
      params.threadName,
      params.oldThreadId,
      params.newThreadId,
    );
  }

  async bindUserToThread(projectId: string, userId: string, threadName: string, threadId: string): Promise<void> {
    await this.userThreadBindingService.bind({
      projectId,
      userId,
      threadName,
      threadId,
    });
  }

  async leaveUserThread(projectId: string, userId: string): Promise<void> {
    await this.userThreadBindingService.leave(projectId, userId);
  }

  async getUserBinding(projectId: string, userId: string): Promise<UserThreadBinding | null> {
    return this.userThreadBindingService.resolve(projectId, userId);
  }

  async getUserActiveThread(projectId: string, userId: string): Promise<{
    threadName: string;
    threadId: string;
    backend: BackendIdentity;
  } | null> {
    const binding = await this.userThreadBindingService.resolve(projectId, userId);
    if (!binding) return null;
    const record = this.threadRegistry.get(projectId, binding.threadName);
    if (!record) return null;
    return {
      threadName: binding.threadName,
      threadId: record.threadId,
      backend: record.backend,
    };
  }

  async getRuntimeState(projectId: string, threadName: string): Promise<ThreadTurnState | null> {
    return this.threadTurnStateRepository.get(projectId, threadName);
  }

  getRuntimeStateSync(projectId: string, threadName: string): ThreadTurnState | null {
    return this.threadTurnStateRepository.getSync(projectId, threadName);
  }

  async markTurnRunning(projectId: string, threadName: string, turnId: string): Promise<void> {
    await this.upsertRuntimeState(projectId, threadName, {
      activeTurnId: turnId,
      blockingTurnId: turnId,
    });
  }

  async markTurnAwaitingApproval(projectId: string, threadName: string, turnId: string): Promise<void> {
    await this.upsertRuntimeState(projectId, threadName, {
      activeTurnId: null,
      blockingTurnId: turnId,
      lastCompletedTurnId: turnId,
    });
  }

  async markTurnCompleted(projectId: string, threadName: string, turnId: string): Promise<void> {
    await this.upsertRuntimeState(projectId, threadName, {
      activeTurnId: null,
      blockingTurnId: null,
      lastCompletedTurnId: turnId,
    });
  }

  async markTurnInterrupted(projectId: string, threadName: string): Promise<void> {
    await this.upsertRuntimeState(projectId, threadName, {
      activeTurnId: null,
      blockingTurnId: null,
    });
  }

  async clearBlockingTurn(projectId: string, threadName: string): Promise<void> {
    await this.upsertRuntimeState(projectId, threadName, { blockingTurnId: null });
  }

  async clearTurnReferences(projectId: string, threadName: string, turnId: string): Promise<void> {
    const current = await this.threadTurnStateRepository.get(projectId, threadName);
    await this.upsertRuntimeState(projectId, threadName, {
      blockingTurnId: current?.blockingTurnId === turnId ? null : undefined,
      lastCompletedTurnId: current?.lastCompletedTurnId === turnId ? null : undefined,
    });
  }

  async getActiveTurnId(projectId: string, threadName: string): Promise<string | null> {
    return (await this.threadTurnStateRepository.get(projectId, threadName))?.activeTurnId ?? null;
  }

  async getLastCompletedTurnId(projectId: string, threadName: string): Promise<string | null> {
    return (await this.threadTurnStateRepository.get(projectId, threadName))?.lastCompletedTurnId ?? null;
  }

  async getLatestRelevantTurnId(projectId: string, threadName: string): Promise<string | null> {
    const state = await this.threadTurnStateRepository.get(projectId, threadName);
    return state?.lastCompletedTurnId ?? state?.activeTurnId ?? null;
  }

  isPendingApproval(projectId: string, threadName: string): boolean {
    const turnId = this.threadTurnStateRepository.getSync(projectId, threadName)?.blockingTurnId;
    if (!turnId || !this.lookupTurnStatusSync) return false;
    return this.lookupTurnStatusSync(projectId, turnId) === "awaiting_approval";
  }

  private async upsertRuntimeState(projectId: string, threadName: string, patch: {
    activeTurnId?: string | null;
    blockingTurnId?: string | null;
    lastCompletedTurnId?: string | null;
  }): Promise<void> {
    const current = await this.threadTurnStateRepository.get(projectId, threadName);
    await this.threadTurnStateRepository.upsert({
      projectId,
      threadName,
      activeTurnId: patch.activeTurnId === undefined ? current?.activeTurnId : (patch.activeTurnId ?? undefined),
      blockingTurnId: patch.blockingTurnId === undefined ? current?.blockingTurnId : (patch.blockingTurnId ?? undefined),
      lastCompletedTurnId: patch.lastCompletedTurnId === undefined ? current?.lastCompletedTurnId : (patch.lastCompletedTurnId ?? undefined),
      updatedAt: this.nowIso(),
    });
  }
}
