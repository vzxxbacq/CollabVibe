import { describe, expect, it } from "vitest";

import { createBackendIdentity } from "../../../../../packages/agent-core/src/backend-identity";
import { ThreadService } from "../../src/thread-state/thread-service";
import type { ThreadRegistry, ThreadRecord, ThreadReservation } from "../../src/thread-state/thread-registry";
import { UserThreadBindingService } from "../../src/thread-state/user-thread-binding-service";
import { InMemoryThreadTurnStateRepository } from "../../src/thread-state/thread-turn-state-repository";
import { InMemoryTurnRepository } from "../../src/turn-state/turn-repository";

class FakeThreadRegistry implements ThreadRegistry {
  private readonly records = new Map<string, ThreadRecord>();
  private readonly reservations = new Map<string, Omit<ThreadRecord, "threadId">>();
  private seq = 0;

  reserve(record: Omit<ThreadRecord, "threadId">): ThreadReservation {
    const key = this.key(record.projectId ?? record.chatId ?? "", record.threadName);
    if (this.records.has(key) || [...this.reservations.values()].some((item) => (item.projectId ?? item.chatId) === (record.projectId ?? record.chatId) && item.threadName === record.threadName)) {
      throw new Error(`THREAD_ALREADY_EXISTS:${record.threadName}`);
    }
    const reservationId = `resv-${++this.seq}`;
    this.reservations.set(reservationId, record);
    return { reservationId, projectId: record.projectId ?? record.chatId ?? "", chatId: record.chatId, threadName: record.threadName };
  }

  activate(reservationId: string, record: ThreadRecord): void {
    this.reservations.delete(reservationId);
    this.records.set(this.key(record.projectId ?? record.chatId ?? "", record.threadName), record);
  }

  release(reservationId: string): void {
    this.reservations.delete(reservationId);
  }

  register(record: ThreadRecord): void {
    const key = this.key(record.projectId ?? record.chatId ?? "", record.threadName);
    if (this.records.has(key)) throw new Error(`THREAD_ALREADY_EXISTS:${record.threadName}`);
    this.records.set(key, record);
  }

  get(projectId: string, threadName: string): ThreadRecord | null {
    return this.records.get(this.key(projectId, threadName)) ?? null;
  }

  list(projectId: string): ThreadRecord[] {
    return [...this.records.values()].filter((record) => (record.projectId ?? record.chatId) === projectId);
  }

  listAll(): ThreadRecord[] {
    return [...this.records.values()];
  }

  remove(projectId: string, threadName: string): void {
    this.records.delete(this.key(projectId, threadName));
  }

  private key(projectId: string, threadName: string): string {
    return `${projectId}:${threadName}`;
  }
}

describe("thread-service", () => {
  it("covers thread record lifecycle: reserve/activate/release/register/list/remove", async () => {
    const service = new ThreadService(
      new FakeThreadRegistry(),
      new UserThreadBindingService(),
      new InMemoryThreadTurnStateRepository(),
      () => "2026-03-16T00:00:00.000Z",
    );
    const backend = createBackendIdentity("codex", "gpt-5");

    const reservation = service.reserve({ projectId: "proj-1", threadName: "main", backend });
    service.activate(reservation.reservationId, { projectId: "proj-1", threadName: "main", threadId: "thr-1", backend });

    expect(service.getRecord("proj-1", "main")?.threadId).toBe("thr-1");
    expect(service.listRecords("proj-1")).toHaveLength(1);

    const secondReservation = service.reserve({ projectId: "proj-1", threadName: "temp", backend });
    service.release(secondReservation.reservationId);
    service.register({ projectId: "proj-1", threadName: "other", threadId: "thr-2", backend });

    expect(service.listAllRecords().map((item) => item.threadName).sort()).toEqual(["main", "other"]);
    service.markMerged("proj-1", "other");
    expect(service.getRecord("proj-1", "other")).toBeNull();
  });

  it("covers user binding and active thread lookup", async () => {
    const service = new ThreadService(
      new FakeThreadRegistry(),
      new UserThreadBindingService(),
      new InMemoryThreadTurnStateRepository(),
      () => "2026-03-16T00:00:00.000Z",
    );
    const backend = createBackendIdentity("codex", "gpt-5");
    service.register({ projectId: "proj-1", threadName: "main", threadId: "thr-1", backend });

    expect(await service.getUserBinding("proj-1", "u1")).toBeNull();
    expect(await service.getUserActiveThread("proj-1", "u1")).toBeNull();

    await service.bindUserToThread("proj-1", "u1", "main", "thr-1");
    expect((await service.getUserBinding("proj-1", "u1"))?.threadName).toBe("main");
    expect((await service.getUserActiveThread("proj-1", "u1"))).toEqual({
      threadName: "main",
      threadId: "thr-1",
      backend,
    });

    await service.leaveUserThread("proj-1", "u1");
    expect(await service.getUserBinding("proj-1", "u1")).toBeNull();
  });

  it("covers runtime state transitions and approval semantics", async () => {
    const turns = new InMemoryTurnRepository();
    await turns.create({
      projectId: "proj-1",
      chatId: "chat-1",
      threadName: "main",
      threadId: "thr-1",
      turnId: "turn-1",
      status: "awaiting_approval",
      cwd: "/tmp/main",
      approvalRequired: true,
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z",
    });
    await turns.create({
      projectId: "proj-1",
      chatId: "chat-1",
      threadName: "main",
      threadId: "thr-1",
      turnId: "turn-2",
      status: "completed",
      cwd: "/tmp/main",
      approvalRequired: false,
      createdAt: "2026-03-16T00:01:00.000Z",
      updatedAt: "2026-03-16T00:01:00.000Z",
    });

    const service = new ThreadService(
      new FakeThreadRegistry(),
      new UserThreadBindingService(),
      new InMemoryThreadTurnStateRepository(),
      () => "2026-03-16T00:00:00.000Z",
      (projectId, turnId) => turns.getByTurnIdSync(projectId, turnId)?.status,
    );

    await service.markTurnRunning("proj-1", "main", "turn-1");
    expect(await service.getActiveTurnId("proj-1", "main")).toBe("turn-1");
    expect(service.isPendingApproval("proj-1", "main")).toBe(true);

    await service.markTurnAwaitingApproval("proj-1", "main", "turn-1");
    expect(await service.getRuntimeState("proj-1", "main")).toMatchObject({
      blockingTurnId: "turn-1",
      lastCompletedTurnId: "turn-1",
      activeTurnId: undefined,
    });
    expect(service.isPendingApproval("proj-1", "main")).toBe(true);

    await service.clearBlockingTurn("proj-1", "main");
    expect(service.isPendingApproval("proj-1", "main")).toBe(false);

    await service.markTurnCompleted("proj-1", "main", "turn-2");
    expect(await service.getLastCompletedTurnId("proj-1", "main")).toBe("turn-2");
    expect(await service.getLatestRelevantTurnId("proj-1", "main")).toBe("turn-2");

    await service.markTurnInterrupted("proj-1", "main");
    expect(await service.getActiveTurnId("proj-1", "main")).toBeNull();

    await service.markTurnAwaitingApproval("proj-1", "main", "turn-1");
    await service.clearTurnReferences("proj-1", "main", "turn-1");
    expect(await service.getRuntimeState("proj-1", "main")).toMatchObject({
      blockingTurnId: undefined,
      lastCompletedTurnId: undefined,
    });
  });

  it("returns false for pending approval when turn lookup is unavailable or non-awaiting", async () => {
    const service = new ThreadService(
      new FakeThreadRegistry(),
      new UserThreadBindingService(),
      new InMemoryThreadTurnStateRepository(),
      () => "2026-03-16T00:00:00.000Z",
    );
    await service.markTurnRunning("proj-1", "main", "turn-1");
    expect(service.isPendingApproval("proj-1", "main")).toBe(false);
  });
});
