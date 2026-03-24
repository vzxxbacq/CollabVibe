import type { BackendIdentity } from "../../packages/agent-core/src/index";
import type { TurnStatus } from "../turn/types";
import type { ThreadListEntry, ThreadRegistry, ThreadReservation } from "./contracts";
import type { ThreadRecord } from "./types";
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
    private readonly lookupTurnStatusSync?: (projectId: string, turnId: string) => TurnStatus | undefined | Promise<TurnStatus | undefined>,
  ) {}

  async reserve(record: Omit<ThreadRecord, "threadId">): Promise<ThreadReservation> {
    return await this.threadRegistry.reserve(record);
  }

  async activate(reservationId: string, record: ThreadRecord): Promise<void> {
    await this.threadRegistry.activate(reservationId, record);
  }

  async release(reservationId: string): Promise<void> {
    await this.threadRegistry.release(reservationId);
  }

  async register(record: ThreadRecord): Promise<void> {
    await this.threadRegistry.register(record);
  }

  async getRecord(projectId: string, threadName: string): Promise<ThreadRecord | null> {
    return await this.threadRegistry.get(projectId, threadName);
  }

  async listRecords(projectId: string): Promise<ThreadRecord[]> {
    return await this.threadRegistry.list(projectId);
  }

  async listEntries(projectId: string): Promise<ThreadListEntry[]> {
    const entries = await this.threadRegistry.listEntries?.(projectId);
    if (entries) return entries;
    const records = await this.threadRegistry.list(projectId);
    return records.map((record) => ({
      projectId,
      threadName: record.threadName,
      threadId: record.threadId,
      status: "active" as const,
      backend: record.backend,
    }));
  }

  async listAllRecords(): Promise<ThreadRecord[]> {
    return (await this.threadRegistry.listAll?.()) ?? [];
  }

  async markMerged(projectId: string, threadName: string): Promise<void> {
    await this.threadRegistry.remove(projectId, threadName);
  }

  async updateRecordRuntime(projectId: string, threadName: string, patch: Partial<Pick<ThreadRecord, "baseSha" | "hasDiverged" | "worktreePath">>): Promise<void> {
    if (!this.threadRegistry.update) {
      throw new Error("ThreadRegistry.update is not available");
    }
    await this.threadRegistry.update(projectId, threadName, patch);
  }

  async reinitializeEmptyThread(params: {
    projectId: string;
    threadName: string;
    oldThreadId: string;
    newThreadId: string;
    backend: BackendIdentity;
  }): Promise<void> {
    if (!this.threadRegistry.replaceEmptyThreadId) {
      throw new Error("ThreadRegistry.replaceEmptyThreadId is not available");
    }
    await this.threadRegistry.replaceEmptyThreadId(params);
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
    const record = await this.threadRegistry.get(projectId, binding.threadName);
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

  async isPendingApproval(projectId: string, threadName: string): Promise<boolean> {
    const turnId = (await this.threadTurnStateRepository.get(projectId, threadName))?.blockingTurnId;
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
