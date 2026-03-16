import { describe, expect, it } from "vitest";

import { maskAuditRecord, maskSensitiveText } from "../../src/audit-query";

describe("masking", () => {
  it("masks token/secret/path diff fragments", () => {
    const text =
      "token=abc123 secret:xyz password=123 Authorization: Bearer bearer-token /tmp/private/key.pem apiKey=my-key +++ b/src/app.ts";
    const masked = maskSensitiveText(text);
    expect(masked).toContain("token=***");
    expect(masked).toContain("secret=***");
    expect(masked).toContain("Authorization: Bearer ***");
    expect(masked).toContain("***.pem");
    expect(masked).toContain("apiKey=***");
    expect(masked).toContain("password=***");
    expect(masked).toContain("+++ b/***");
  });

  it("masks nested record detail json", () => {
    const masked = maskAuditRecord({
      id: "a1",
      orgId: "org-1",
      traceId: "trace-1",
      projectId: "chat-1",
      actorId: "u1",
      action: "turn.start",
      result: "success",
      createdAt: "2026-03-01T00:00:00.000Z",
      detailJson: {
        diff: "secret=abc",
        nested: {
          token: "token=123"
        }
      }
    });
    expect(masked.detailJson).toEqual({
      diff: "secret=***",
      nested: {
        token: "token=***"
      }
    });
  });
});
