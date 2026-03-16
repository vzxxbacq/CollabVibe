import { describe, expect, it, vi } from "vitest";

import { ApprovalCallbackHandler } from "../../src/index";

describe("callback-handler", () => {
  it("throws at construction time when bridge is missing", () => {
    expect(() => new ApprovalCallbackHandler({ save: vi.fn(async () => undefined) }, undefined as never)).toThrowError(
      "approval bridge is required"
    );
  });

  it("rejects invalid signature and deduplicates repeated callbacks", async () => {
    const save = vi.fn(async () => undefined);
    const applyDecision = vi.fn(async () => "resolved" as const);
    const handler = new ApprovalCallbackHandler({ save }, { applyDecision });

    const invalid = await handler.handle(
      {
        approvalId: "appr-1",
        approverId: "u1",
        action: "approve"
      },
      false
    );
    const first = await handler.handle(
      {
        approvalId: "appr-1",
        approverId: "u1",
        action: "approve"
      },
      true
    );
    const duplicate = await handler.handle(
      {
        approvalId: "appr-1",
        approverId: "u2",
        action: "deny"
      },
      true
    );

    expect(invalid).toBe("rejected");
    expect(first).toBe("applied");
    expect(duplicate).toBe("duplicate");
    expect(save).toHaveBeenCalledTimes(1);
    expect(applyDecision).toHaveBeenCalledTimes(1);
  });

  it("returns bridge_duplicate when orchestrator already resolved approval", async () => {
    const handler = new ApprovalCallbackHandler(
      { save: vi.fn(async () => undefined) },
      { applyDecision: vi.fn(async () => "duplicate" as const) }
    );

    const result = await handler.handle(
      {
        approvalId: "appr-2",
        approverId: "u1",
        action: "deny"
      },
      true
    );

    expect(result).toBe("bridge_duplicate");
  });

  it("allows retry when persistence or bridge fails before commit", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("db timeout")).mockResolvedValueOnce(undefined);
    const applyDecision = vi.fn(async () => "resolved" as const);
    const handler = new ApprovalCallbackHandler({ save }, { applyDecision });

    await expect(
      handler.handle(
        {
          approvalId: "appr-3",
          approverId: "u1",
          action: "approve"
        },
        true
      )
    ).rejects.toThrowError("db timeout");

    const retried = await handler.handle(
      {
        approvalId: "appr-3",
        approverId: "u1",
        action: "approve"
      },
      true
    );
    expect(retried).toBe("applied");
    expect(save).toHaveBeenCalledTimes(2);
    expect(applyDecision).toHaveBeenCalledTimes(1);
  });
});
