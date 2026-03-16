import { describe, expect, it, vi } from "vitest";

import { AuditService } from "../../src/audit-service";

describe("audit append", () => {
  it("rejects missing required fields", async () => {
    const service = new AuditService({
      append: vi.fn(async () => undefined)
    });

    await expect(
      service.append({
        projectId: "",
        actorId: "u-1",
        action: "turn.start",
        result: "success"
      })
    ).rejects.toThrowError("audit fields projectId/actorId/action/result are required");
  });

  it("appends normalized audit record", async () => {
    const append = vi.fn(async () => undefined);
    const service = new AuditService({ append });
    const record = await service.append({
      projectId: "chat-1",
      actorId: "u-1",
      action: "turn.start",
      result: "success",
      detailJson: { turnId: "turn-1" }
    });

    expect(record.id).toMatch(/^audit_/);
    expect(record.traceId).toMatch(/^trace_/);
    expect(record.orgId).toBe("default-org");
    expect(record.detailJson).toEqual({ turnId: "turn-1" });
    expect(append).toHaveBeenCalledWith(record);
  });
});
