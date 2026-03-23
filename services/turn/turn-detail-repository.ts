import type { TurnDetailRecord } from "./types";

export interface TurnDetailRepository {
  create(record: TurnDetailRecord): Promise<void>;
  update(record: TurnDetailRecord): Promise<void>;
  getByTurnId(projectId: string, turnId: string): Promise<TurnDetailRecord | null>;
}

export class InMemoryTurnDetailRepository implements TurnDetailRepository {
  private readonly byKey = new Map<string, TurnDetailRecord>();

  async create(record: TurnDetailRecord): Promise<void> {
    this.byKey.set(this.keyOf(record.projectId, record.turnId), structuredClone(record));
  }

  async update(record: TurnDetailRecord): Promise<void> {
    this.byKey.set(this.keyOf(record.projectId, record.turnId), structuredClone(record));
  }

  async getByTurnId(projectId: string, turnId: string): Promise<TurnDetailRecord | null> {
    return this.byKey.get(this.keyOf(projectId, turnId)) ?? null;
  }

  private keyOf(projectId: string, turnId: string): string {
    return `${projectId}:${turnId}`;
  }
}
