import type { ThreadTurnState } from "./thread-turn-state";

export interface ThreadTurnStateRepository {
  get(projectId: string, threadName: string): Promise<ThreadTurnState | null>;
  upsert(state: ThreadTurnState): Promise<void>;
}

export class InMemoryThreadTurnStateRepository implements ThreadTurnStateRepository {
  private readonly states = new Map<string, ThreadTurnState>();

  async get(projectId: string, threadName: string): Promise<ThreadTurnState | null> {
    return this.states.get(this.keyOf(projectId, threadName)) ?? null;
  }

  async upsert(state: ThreadTurnState): Promise<void> {
    this.states.set(this.keyOf(state.projectId, state.threadName), { ...state });
  }

  private keyOf(projectId: string, threadName: string): string {
    return `${projectId}:${threadName}`;
  }
}
