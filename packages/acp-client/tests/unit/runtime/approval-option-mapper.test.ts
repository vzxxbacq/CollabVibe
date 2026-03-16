import { describe, expect, it } from "vitest";

import { createApprovalOptionMapper } from "../../../src/approval-option-mapper";

describe("approval-option-mapper", () => {
  it("maps ACP options to IM actions and back", () => {
    const mapper = createApprovalOptionMapper();

    expect(mapper.toImAction("allow_once")).toBe("approve");
    expect(mapper.toImAction("allow_always")).toBe("approve_always");
    expect(mapper.toImAction("deny")).toBe("deny");
    expect(mapper.toImAction("unknown")).toBeNull();

    expect(mapper.toOptionId("approve")).toBe("allow_once");
    expect(mapper.toOptionId("approve_always")).toBe("allow_always");
    expect(mapper.toOptionId("deny")).toBe("deny");
  });
});
