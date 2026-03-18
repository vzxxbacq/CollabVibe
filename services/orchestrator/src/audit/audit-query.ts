import type { AuditEventRecord } from "./audit-service";

export interface AuditQuery {
  projectId?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogReader {
  query(query: AuditQuery): Promise<AuditEventRecord[]>;
}

export async function queryAuditLogs(reader: AuditLogReader, query: AuditQuery): Promise<AuditEventRecord[]> {
  if (!reader.query) {
    throw new Error("audit reader query() is required");
  }
  return reader.query(query);
}

export function maskSensitiveText(input: string): string {
  return input
    .replace(/(token|secret|api[_-]?key)\s*[:=]\s*([^\s]+)/gi, (_m, label) => `${label}=***`)
    .replace(/(password)\s*[:=]\s*([^\s]+)/gi, "$1=***")
    .replace(/(Authorization:\s*Bearer)\s+[^\s]+/gi, "$1 ***")
    .replace(/(\/[^\s]+\.pem)/gi, "***.pem")
    .replace(/(\+\+\+ b\/|--- a\/)([^\s]+)/g, "$1***");
}

export function maskAuditRecord(record: AuditEventRecord): AuditEventRecord {
  return {
    ...record,
    detailJson: JSON.parse(
      JSON.stringify(record.detailJson, (_key, value) => {
        if (typeof value === "string") {
          return maskSensitiveText(value);
        }
        return value;
      })
    )
  };
}
