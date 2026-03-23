import type { TurnRecord, TurnStatus } from "./types";

export interface TurnRepository {
  create(record: TurnRecord): Promise<void>;
  update(record: TurnRecord): Promise<void>;
  getByTurnIdSync(projectId: string, turnId: string): TurnRecord | null;
  getByTurnId(projectId: string, turnId: string): Promise<TurnRecord | null>;
  getByCallIdSync(projectId: string, callId: string): TurnRecord | null;
  getByCallId(projectId: string, callId: string): Promise<TurnRecord | null>;
  listByThread(projectId: string, threadName: string, limit?: number): Promise<TurnRecord[]>;
  listByProject(projectId: string, limit?: number): Promise<TurnRecord[]>;
  findBlockingTurn(projectId: string, threadName: string): Promise<TurnRecord | null>;
  getLastCompletedTurn(projectId: string, threadName: string): Promise<TurnRecord | null>;
  getMaxTurnNumber(projectId: string, threadName: string): Promise<number>;
}

export class InMemoryTurnRepository implements TurnRepository {
  private readonly byKey = new Map<string, TurnRecord>();

  async create(record: TurnRecord): Promise<void> {
    this.byKey.set(this.keyOf(record.projectId, record.turnId), { ...record });
  }

  async update(record: TurnRecord): Promise<void> {
    this.byKey.set(this.keyOf(record.projectId, record.turnId), { ...record });
  }

  async getByTurnId(projectId: string, turnId: string): Promise<TurnRecord | null> {
    return this.getByTurnIdSync(projectId, turnId);
  }

  async getByCallId(projectId: string, callId: string): Promise<TurnRecord | null> {
    return this.getByCallIdSync(projectId, callId);
  }

  getByTurnIdSync(projectId: string, turnId: string): TurnRecord | null {
    return [...this.byKey.values()].find((item) =>
      item.turnId === turnId && item.projectId === projectId
    ) ?? null;
  }

  getByCallIdSync(projectId: string, callId: string): TurnRecord | null {
    return [...this.byKey.values()].find((item) =>
      item.callId === callId && item.projectId === projectId
    ) ?? null;
  }

  async listByThread(projectId: string, threadName: string, limit = 20): Promise<TurnRecord[]> {
    return [...this.byKey.values()]
      .filter((item) => item.projectId === projectId && item.threadName === threadName)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async listByProject(projectId: string, limit = 20): Promise<TurnRecord[]> {
    return [...this.byKey.values()]
      .filter((item) => item.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async findBlockingTurn(projectId: string, threadName: string): Promise<TurnRecord | null> {
    const blocking = new Set<TurnStatus>(["running", "awaiting_approval"]);
    return [...this.byKey.values()]
      .filter((item) => item.projectId === projectId && item.threadName === threadName && blocking.has(item.status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
  }

  async getLastCompletedTurn(projectId: string, threadName: string): Promise<TurnRecord | null> {
    const completed = new Set<TurnStatus>(["completed", "awaiting_approval", "accepted"]);
    return [...this.byKey.values()]
      .filter((item) => item.projectId === projectId && item.threadName === threadName && completed.has(item.status))
      .sort((a, b) => (b.completedAt ?? b.updatedAt).localeCompare(a.completedAt ?? a.updatedAt))[0] ?? null;
  }

  async getMaxTurnNumber(projectId: string, threadName: string): Promise<number> {
    let max = 0;
    for (const item of this.byKey.values()) {
      if (item.projectId === projectId && item.threadName === threadName && (item.turnNumber ?? 0) > max) {
        max = item.turnNumber!;
      }
    }
    return max;
  }

  private keyOf(projectId: string, turnId: string): string {
    return `${projectId}:${turnId}`;
  }
}
