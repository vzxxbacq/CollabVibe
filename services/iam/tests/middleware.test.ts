import { describe, expect, it } from "vitest";

import { AuthorizationError, authorize } from "../src/index";

describe("authorize middleware", () => {
  it("rejects unauthenticated access", () => {
    expect(() => authorize(null, "project.create")).toThrowError(AuthorizationError);
  });

  it("rejects unauthorized role", () => {
    expect(() => authorize("developer", "skill.install")).toThrowError(AuthorizationError);
  });

  it("allows valid role", () => {
    expect(() => authorize("project_owner", "skill.install")).not.toThrow();
  });
});
