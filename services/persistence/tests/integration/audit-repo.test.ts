import { describe, expect, it } from "vitest";

import { AuditLogRepository } from "../../src/audit-log-repository";

describe("audit log repository", () => {
  it("appends and queries logs by project", async () => {
    const repo = new AuditLogRepository();

    await repo.append({
      id: "audit-1",
      projectId: "proj-1",
      actorId: "user-1",
      action: "project.create",
      result: "success",
      createdAt: "2026-03-07T00:00:00Z"
    });
    await repo.append({
      id: "audit-2",
      projectId: "proj-1",
      actorId: "user-2",
      action: "turn.interrupt",
      result: "success",
      createdAt: "2026-03-07T00:00:05Z"
    });
    await repo.append({
      id: "audit-3",
      projectId: "proj-2",
      actorId: "user-3",
      action: "project.read",
      result: "success",
      createdAt: "2026-03-07T00:00:06Z"
    });

    const logs = await repo.listByProject("proj-1");
    expect(logs).toHaveLength(2);
    expect(logs[0]?.id).toBe("audit-2");
    expect(logs[1]?.id).toBe("audit-1");
  });

  it("rolls back append when transaction fails", async () => {
    const repo = new AuditLogRepository();

    await expect(
      repo.withTransaction(async (txRepo) => {
        await txRepo.append({
          id: "audit-1",
          projectId: "proj-1",
          actorId: "user-1",
          action: "project.create",
          result: "success",
          createdAt: "2026-03-07T00:00:00Z"
        });
        throw new Error("rollback");
      })
    ).rejects.toThrowError("rollback");

    await expect(repo.listByProject("proj-1")).resolves.toEqual([]);
  });
});
