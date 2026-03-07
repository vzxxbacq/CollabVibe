export interface AuditLogRecord {
  id: string;
  projectId: string;
  actorId: string;
  action: string;
  result: string;
  createdAt: string;
}

export interface AuditLogRepositoryPort {
  append(log: AuditLogRecord): Promise<void>;
  listByProject(projectId: string, limit?: number): Promise<AuditLogRecord[]>;
  withTransaction<T>(work: (repo: AuditLogRepositoryPort) => Promise<T>): Promise<T>;
}

export class AuditLogRepository implements AuditLogRepositoryPort {
  private readonly logs = new Map<string, AuditLogRecord>();

  async append(log: AuditLogRecord): Promise<void> {
    this.logs.set(log.id, log);
  }

  async listByProject(projectId: string, limit = 50): Promise<AuditLogRecord[]> {
    return [...this.logs.values()]
      .filter((log) => log.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async withTransaction<T>(work: (repo: AuditLogRepositoryPort) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.logs);
    try {
      return await work(this);
    } catch (error) {
      this.logs.clear();
      for (const [key, value] of snapshot.entries()) {
        this.logs.set(key, value);
      }
      throw error;
    }
  }
}
