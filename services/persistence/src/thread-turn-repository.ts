/**
 * @deprecated Legacy in-memory thread/turn repository kept only for compatibility
 * with persistence tests and historical imports. Do not use in production code.
 * Use SqliteThreadRegistry / SqliteTurnRepository / SqliteTurnDetailRepository instead.
 */
export interface ThreadRecord {
  id: string;
  projectId: string;
  chatId: string;
  codexThreadId: string;
  status: "active" | "closed";
}

export interface ThreadRepositoryPort {
  upsertByProjectChat(thread: ThreadRecord): Promise<void>;
  getByProjectChat(projectId: string, chatId: string): Promise<ThreadRecord | null>;
  withTransaction<T>(work: (repo: ThreadRepositoryPort) => Promise<T>): Promise<T>;
}

export interface TurnRecord {
  id: string;
  threadId: string;
  codexTurnId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  endedAt?: string;
}

export interface TurnRepositoryPort {
  create(turn: TurnRecord): Promise<void>;
  getById(id: string): Promise<TurnRecord | null>;
  transition(id: string, status: "running" | "completed" | "failed", endedAt?: string): Promise<void>;
  withTransaction<T>(work: (repo: TurnRepositoryPort) => Promise<T>): Promise<T>;
}

export class ThreadRepository implements ThreadRepositoryPort {
  private readonly threads = new Map<string, ThreadRecord>();

  async upsertByProjectChat(thread: ThreadRecord): Promise<void> {
    this.threads.set(`${thread.projectId}:${thread.chatId}`, thread);
  }

  async getByProjectChat(projectId: string, chatId: string): Promise<ThreadRecord | null> {
    return this.threads.get(`${projectId}:${chatId}`) ?? null;
  }

  async withTransaction<T>(work: (repo: ThreadRepositoryPort) => Promise<T>): Promise<T> {
    const workingThreads = new Map(this.threads);
    const changedKeys = new Set<string>();

    const txRepo: ThreadRepositoryPort = {
      upsertByProjectChat: async (thread) => {
        const key = `${thread.projectId}:${thread.chatId}`;
        workingThreads.set(key, thread);
        changedKeys.add(key);
      },
      getByProjectChat: async (projectId, chatId) => workingThreads.get(`${projectId}:${chatId}`) ?? null,
      withTransaction: async <R>(nestedWork: (repo: ThreadRepositoryPort) => Promise<R>) => nestedWork(txRepo)
    };

    const result = await work(txRepo);
    for (const key of changedKeys) {
      const thread = workingThreads.get(key);
      if (thread) this.threads.set(key, thread);
    }
    return result;
  }
}

export class TurnRepository implements TurnRepositoryPort {
  private readonly turns = new Map<string, TurnRecord>();

  async create(turn: TurnRecord): Promise<void> {
    this.turns.set(turn.id, turn);
  }

  async getById(id: string): Promise<TurnRecord | null> {
    return this.turns.get(id) ?? null;
  }

  async transition(id: string, status: "running" | "completed" | "failed", endedAt?: string): Promise<void> {
    const turn = this.turns.get(id);
    if (!turn) throw new Error("turn not found");
    this.turns.set(id, { ...turn, status, endedAt: endedAt ?? turn.endedAt });
  }

  async withTransaction<T>(work: (repo: TurnRepositoryPort) => Promise<T>): Promise<T> {
    const workingTurns = new Map(this.turns);
    const changedIds = new Set<string>();

    const txRepo: TurnRepositoryPort = {
      create: async (turn) => {
        workingTurns.set(turn.id, turn);
        changedIds.add(turn.id);
      },
      getById: async (id) => workingTurns.get(id) ?? null,
      transition: async (id, status, endedAt) => {
        const turn = workingTurns.get(id);
        if (!turn) throw new Error("turn not found");
        workingTurns.set(id, { ...turn, status, endedAt: endedAt ?? turn.endedAt });
        changedIds.add(id);
      },
      withTransaction: async <R>(nestedWork: (repo: TurnRepositoryPort) => Promise<R>) => nestedWork(txRepo)
    };

    const result = await work(txRepo);
    for (const id of changedIds) {
      const turn = workingTurns.get(id);
      if (turn) this.turns.set(id, turn);
    }
    return result;
  }
}
