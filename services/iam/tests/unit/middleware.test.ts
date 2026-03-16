import { describe, expect, it } from "vitest";

import { AuthorizationError, authorize } from "../../src/index";

describe("authorize middleware", () => {
  it("rejects unauthenticated access", () => {
    expect(() => authorize(null, "project.read")).toThrowError(AuthorizationError);
  });

  it("rejects unauthorized role", () => {
    expect(() => authorize("developer", "skill.manage")).toThrowError(AuthorizationError);
  });

  it("allows valid role", () => {
    expect(() => authorize("maintainer", "skill.manage")).not.toThrow();
  });
});
