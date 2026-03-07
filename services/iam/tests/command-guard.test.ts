import { describe, expect, it } from "vitest";

import { AuthorizationError, authorizeIntent } from "../src/index";

describe("command guard", () => {
  it("permits /thread new for developer", () => {
    expect(() => authorizeIntent("developer", "THREAD_NEW")).not.toThrow();
  });

  it("blocks /skill install for developer", () => {
    expect(() => authorizeIntent("developer", "SKILL_INSTALL")).toThrowError(AuthorizationError);
  });

  it("permits /project create for platform admin", () => {
    expect(() => authorizeIntent("platform_admin", "PROJECT_CREATE")).not.toThrow();
  });

  it("blocks /project create for developer", () => {
    expect(() => authorizeIntent("developer", "PROJECT_CREATE")).toThrowError(AuthorizationError);
  });

  it("permits /thread new for project owner", () => {
    expect(() => authorizeIntent("project_owner", "THREAD_NEW")).not.toThrow();
  });

  it("permits all mapped intents for platform admin", () => {
    const intents = [
      "PROJECT_CREATE",
      "PROJECT_LIST",
      "THREAD_NEW",
      "THREAD_RESUME",
      "SKILL_INSTALL",
      "SKILL_LIST",
      "TURN_INTERRUPT",
      "TURN_START"
    ] as const;

    for (const intent of intents) {
      expect(() => authorizeIntent("platform_admin", intent)).not.toThrow();
    }
  });
});
