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
    const snapshot = new Map(this.threads);
    try {
      return await work(this);
    } catch (error) {
      this.threads.clear();
      for (const [key, value] of snapshot.entries()) {
        this.threads.set(key, value);
      }
      throw error;
    }
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

  async transition(
    id: string,
    status: "running" | "completed" | "failed",
    endedAt?: string
  ): Promise<void> {
    const turn = this.turns.get(id);
    if (!turn) {
      throw new Error("turn not found");
    }

    this.turns.set(id, {
      ...turn,
      status,
      endedAt: endedAt ?? turn.endedAt
    });
  }

  async withTransaction<T>(work: (repo: TurnRepositoryPort) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.turns);
    try {
      return await work(this);
    } catch (error) {
      this.turns.clear();
      for (const [key, value] of snapshot.entries()) {
        this.turns.set(key, value);
      }
      throw error;
    }
  }
}
