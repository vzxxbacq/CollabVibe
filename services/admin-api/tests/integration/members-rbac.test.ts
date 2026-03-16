import { describe, expect, it, vi } from "vitest";

import { AdminApiService } from "../../src/index";

function makeService() {
  return new AdminApiService({
    secretStore: {
      write: vi.fn(async () => undefined),
      read: vi.fn(async () => null)
    }
  });
}

describe("members-rbac", () => {
  it("supports invite + role update and blocks unauthorized actor", () => {
    const service = makeService();

    expect(() =>
      service.inviteMember("proj-1", "developer", {
        userId: "u-1",
        role: "developer"
      })
    ).toThrowError("forbidden");

    const invited = service.inviteMember("proj-1", "maintainer", {
      userId: "u-1",
      role: "developer"
    });
    expect(invited).toEqual({ userId: "u-1", role: "developer" });

    const updated = service.updateMemberRole("proj-1", "maintainer", "u-1", "auditor");
    expect(updated.role).toBe("auditor");
  });

  it("rejects duplicate invite and missing member update", () => {
    const service = makeService();
    service.inviteMember("proj-1", "maintainer", {
      userId: "u-1",
      role: "developer"
    });

    expect(() =>
      service.inviteMember("proj-1", "maintainer", {
        userId: "u-1",
        role: "developer"
      })
    ).toThrowError("member already exists");
    expect(() => service.updateMemberRole("proj-1", "maintainer", "missing", "auditor")).toThrowError(
      "member not found"
    );
    expect(() => service.updateMemberRole("proj-1", "developer", "u-1", "auditor")).toThrowError("forbidden");
  });
});
