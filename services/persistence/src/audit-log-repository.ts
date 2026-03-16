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
    const workingLogs = new Map(this.logs);
    const changedIds = new Set<string>();

    const txRepo: AuditLogRepositoryPort = {
      append: async (log) => {
        workingLogs.set(log.id, log);
        changedIds.add(log.id);
      },
      listByProject: async (projectId, limit = 50) => {
        return [...workingLogs.values()]
          .filter((log) => log.projectId === projectId)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
          .slice(0, limit);
      },
      withTransaction: async <R>(nestedWork: (repo: AuditLogRepositoryPort) => Promise<R>) => nestedWork(txRepo)
    };

    const result = await work(txRepo);
    for (const id of changedIds) {
      const log = workingLogs.get(id);
      if (log) {
        this.logs.set(id, log);
      }
    }
    return result;
  }
}
