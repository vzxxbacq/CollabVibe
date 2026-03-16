import { describe, expect, it, vi } from "vitest";
import { RoleResolver } from "../../src/role-resolver";
import type { UserRepository } from "../../../../packages/channel-core/src/user-repository";

function createMockUserRepo(adminIds: string[] = []): UserRepository {
  const admins = new Set(adminIds);
  const users = new Set<string>();
  return {
    isAdmin: vi.fn((id: string) => admins.has(id)),
    listAdmins: vi.fn(() => [...admins].map(id => ({ userId: id, sysRole: 1 as const, source: "env" as const }))),
    setAdmin: vi.fn((id: string) => { admins.add(id); }),
    removeAdmin: vi.fn(() => ({ ok: true })),
    ensureUser: vi.fn((id: string) => { users.add(id); }),
    listAll: vi.fn(() => ({ users: [], total: 0 })),
  };
}

function createMockStore(members: Record<string, Array<{ userId: string; role: string }>> = {}) {
  const state = { projects: [], members, wizardStep: {} };
  return {
    read: vi.fn(() => state),
    write: vi.fn((s: typeof state) => { Object.assign(state, s); })
  };
}

describe("RoleResolver", () => {
  it("returns admin for sysAdmin users regardless of project", () => {
    const resolver = new RoleResolver(createMockUserRepo(["admin-1"]), createMockStore());
    expect(resolver.resolve("admin-1")).toBe("admin");
    expect(resolver.resolve("admin-1", "proj-1")).toBe("admin");
    expect(resolver.resolve("admin-1", null)).toBe("admin");
  });

  it("returns auditor when no projectId is provided for non-admin", () => {
    const resolver = new RoleResolver(createMockUserRepo(), createMockStore());
    expect(resolver.resolve("user-1")).toBe("auditor");
    expect(resolver.resolve("user-1", null)).toBe("auditor");
  });

  it("returns project member role when user exists in project", () => {
    const store = createMockStore({
      "proj-1": [
        { userId: "user-1", role: "maintainer" },
        { userId: "user-2", role: "developer" }
      ]
    });
    const resolver = new RoleResolver(createMockUserRepo(), store);
    expect(resolver.resolve("user-1", "proj-1")).toBe("maintainer");
    expect(resolver.resolve("user-2", "proj-1")).toBe("developer");
  });

  it("returns auditor for unknown user in project (no auto-register)", () => {
    const store = createMockStore({ "proj-1": [] });
    const resolver = new RoleResolver(createMockUserRepo(), store);
    expect(resolver.resolve("new-user", "proj-1")).toBe("auditor");
    expect(store.write).not.toHaveBeenCalled();
  });

  it("auto-registers unknown user as auditor when autoRegister is true", () => {
    const userRepo = createMockUserRepo();
    const store = createMockStore({ "proj-1": [] });
    const resolver = new RoleResolver(userRepo, store);
    const role = resolver.resolve("new-user", "proj-1", { autoRegister: true });
    expect(role).toBe("auditor");
    expect(store.write).toHaveBeenCalledTimes(1);
    // Verify the user was added to project members
    const state = store.read();
    expect(state.members["proj-1"]).toContainEqual({ userId: "new-user", role: "auditor" });
    // Also ensures user in users table
    expect(userRepo.ensureUser).toHaveBeenCalledWith("new-user");
  });

  it("auto-register is idempotent", () => {
    const store = createMockStore({ "proj-1": [{ userId: "existing", role: "developer" }] });
    const resolver = new RoleResolver(createMockUserRepo(), store);
    resolver.resolve("existing", "proj-1", { autoRegister: true });
    expect(store.write).not.toHaveBeenCalled();
  });

  it("creates member array for project if missing", () => {
    const store = createMockStore({});
    const resolver = new RoleResolver(createMockUserRepo(), store);
    resolver.resolve("new-user", "proj-new", { autoRegister: true });
    const state = store.read();
    expect(state.members["proj-new"]).toContainEqual({ userId: "new-user", role: "auditor" });
  });

  it("isAdmin returns correct value", () => {
    const resolver = new RoleResolver(createMockUserRepo(["admin-1", "admin-2"]), createMockStore());
    expect(resolver.isAdmin("admin-1")).toBe(true);
    expect(resolver.isAdmin("admin-2")).toBe(true);
    expect(resolver.isAdmin("user-1")).toBe(false);
  });

  it("admin always wins over project role", () => {
    const store = createMockStore({
      "proj-1": [{ userId: "admin-1", role: "developer" }]
    });
    const resolver = new RoleResolver(createMockUserRepo(["admin-1"]), store);
    // Even though admin-1 is listed as developer in the project, they get admin
    expect(resolver.resolve("admin-1", "proj-1")).toBe("admin");
  });
});
