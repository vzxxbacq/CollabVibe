export interface AuditEventInput {
  projectId: string;
  actorId: string;
  action: string;
  result: string;
  orgId?: string;
  traceId?: string;
  correlationId?: string;
  detailJson?: Record<string, unknown>;
  createdAt?: string;
}

export interface AuditEventRecord extends AuditEventInput {
  id: string;
  orgId: string;
  traceId: string;
  correlationId?: string;
  detailJson: Record<string, unknown>;
  createdAt: string;
}

export interface AuditStore {
  append(record: AuditEventRecord): Promise<void>;
}

function randomId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export class AuditService {
  private readonly store: AuditStore;

  constructor(store: AuditStore) {
    this.store = store;
  }

  async append(input: AuditEventInput): Promise<AuditEventRecord> {
    if (!input.projectId || !input.actorId || !input.action || !input.result) {
      throw new Error("audit fields projectId/actorId/action/result are required");
    }

    const record: AuditEventRecord = {
      id: randomId("audit"),
      orgId: input.orgId ?? "default-org",
      traceId: input.traceId ?? randomId("trace"),
      correlationId: input.correlationId ?? input.traceId,
      detailJson: {
        ...(input.detailJson ?? {}),
        ...(input.correlationId || input.traceId
          ? { correlationId: input.correlationId ?? input.traceId }
          : {})
      },
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...input
    };
    await this.store.append(record);
    return record;
  }
}
