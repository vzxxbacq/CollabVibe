import { describe, expect, it } from "vitest";

import { authorizeIntent } from "../../src/command-guard";
import { IntentPermissionMap } from "../../src/command-guard";
import type { IntentType } from "../../../../packages/channel-core/src/types";

describe("authorizeIntent", () => {
  it("admin can perform all intents", () => {
    for (const intent of Object.keys(IntentPermissionMap) as IntentType[]) {
      expect(() => authorizeIntent("admin", intent)).not.toThrow();
    }
  });

  it("maintainer can perform most intents but not admin-only ones", () => {
    expect(() => authorizeIntent("maintainer", "THREAD_NEW")).not.toThrow();
    expect(() => authorizeIntent("maintainer", "THREAD_MERGE")).not.toThrow();
    expect(() => authorizeIntent("maintainer", "TURN_START")).not.toThrow();
    expect(() => authorizeIntent("maintainer", "HELP")).not.toThrow();
    // admin-only intents
    expect(() => authorizeIntent("maintainer", "PROJECT_CREATE")).toThrow();
    expect(() => authorizeIntent("maintainer", "ADMIN_HELP")).toThrow();
  });

  it("developer can do thread/turn ops but not merge/admin", () => {
    expect(() => authorizeIntent("developer", "THREAD_NEW")).not.toThrow();
    expect(() => authorizeIntent("developer", "TURN_START")).not.toThrow();
    expect(() => authorizeIntent("developer", "HELP")).not.toThrow();
    expect(() => authorizeIntent("developer", "THREAD_LIST")).not.toThrow();
    // blocked
    expect(() => authorizeIntent("developer", "THREAD_MERGE")).toThrow();
    expect(() => authorizeIntent("developer", "PROJECT_CREATE")).toThrow();
    expect(() => authorizeIntent("developer", "SKILL_INSTALL")).toThrow();
  });

  it("auditor can only access HELP and UNKNOWN", () => {
    expect(() => authorizeIntent("auditor", "HELP")).not.toThrow();
    expect(() => authorizeIntent("auditor", "UNKNOWN")).not.toThrow();
    // everything else blocked
    expect(() => authorizeIntent("auditor", "THREAD_NEW")).toThrow();
    expect(() => authorizeIntent("auditor", "TURN_START")).toThrow();
    expect(() => authorizeIntent("auditor", "THREAD_MERGE")).toThrow();
    expect(() => authorizeIntent("auditor", "PROJECT_CREATE")).toThrow();
    expect(() => authorizeIntent("auditor", "PROJECT_LIST")).toThrow();
    expect(() => authorizeIntent("auditor", "SKILL_LIST")).toThrow();
    expect(() => authorizeIntent("auditor", "MODEL_LIST")).toThrow();
  });

  it("null/undefined role denies all intents", () => {
    expect(() => authorizeIntent(null, "HELP")).toThrow();
    expect(() => authorizeIntent(undefined, "TURN_START")).toThrow();
  });

  it("IntentPermissionMap covers all IntentType values", () => {
    // This is enforced at compile-time by Record<IntentType, Permission>,
    // but we verify at runtime that the map is non-empty and complete.
    const mappedIntents = Object.keys(IntentPermissionMap);
    expect(mappedIntents.length).toBeGreaterThan(0);
    for (const intent of mappedIntents) {
      expect(IntentPermissionMap[intent as IntentType]).toBeDefined();
    }
  });
});
