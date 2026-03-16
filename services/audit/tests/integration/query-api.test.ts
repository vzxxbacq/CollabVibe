import { describe, expect, it } from "vitest";

import { queryAuditLogs } from "../../src/audit-query";
import type { AuditEventRecord } from "../../src/audit-service";

const sample: AuditEventRecord[] = [
  {
    id: "a1",
    orgId: "org-1",
    traceId: "trace-1",
    projectId: "chat-1",
    actorId: "u1",
    action: "turn.start",
    result: "success",
    detailJson: {},
    createdAt: "2026-03-01T00:00:00.000Z"
  },
  {
    id: "a2",
    orgId: "org-1",
    traceId: "trace-2",
    projectId: "chat-2",
    actorId: "u2",
    action: "approval.decide",
    result: "denied",
    detailJson: {},
    createdAt: "2026-03-05T00:00:00.000Z"
  }
];

describe("query-api", () => {
  it("filters by project/action/time range", async () => {
    const result = await queryAuditLogs(
      {
        query: async () => sample.filter((row) => row.projectId === "chat-2" && row.action === "approval.decide")
      },
      {
        projectId: "chat-2",
        action: "approval.decide",
        from: "2026-03-04T00:00:00.000Z",
        to: "2026-03-06T00:00:00.000Z"
      }
    );

    expect(result).toEqual([sample[1]]);
  });

  it("supports server-side query provider", async () => {
    const query = { projectId: "chat-1", limit: 1, offset: 0 };
    const fromQuery = await queryAuditLogs(
      {
        query: async () => [sample[0]]
      },
      query
    );
    expect(fromQuery).toEqual([sample[0]]);
  });

  it("fails fast when reader does not implement query", async () => {
    await expect(
      queryAuditLogs(
        {
          query: undefined as never
        },
        { projectId: "chat-1" }
      )
    ).rejects.toThrowError("audit reader query() is required");
  });
});
