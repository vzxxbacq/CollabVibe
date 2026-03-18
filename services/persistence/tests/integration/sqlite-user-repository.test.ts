import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, beforeEach } from "vitest";

import { SqliteUserRepository } from "../../src/sqlite-user-repository";

describe("SqliteUserRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteUserRepository;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    repo = new SqliteUserRepository(db);
  });

  // ── seedEnvAdmins ────────────────────────────────────────────────────

  it("seeds env admins idempotently", () => {
    repo.seedEnvAdmins(["env-1", "env-2"]);
    expect(repo.isAdmin("env-1")).toBe(true);
    expect(repo.isAdmin("env-2")).toBe(true);

    // Second call should not error
    repo.seedEnvAdmins(["env-1", "env-2", "env-3"]);
    expect(repo.listAdmins()).toHaveLength(3);
  });

  it("upgrades runtime admin to env when seeded", () => {
    repo.setAdmin("user-1", "im");
    expect(repo.listAdmins().find(a => a.userId === "user-1")?.source).toBe("im");

    repo.seedEnvAdmins(["user-1"]);
    expect(repo.listAdmins().find(a => a.userId === "user-1")?.source).toBe("env");
  });

  // ── isAdmin ──────────────────────────────────────────────────────────

  it("returns false for unknown user", () => {
    expect(repo.isAdmin("nobody")).toBe(false);
  });

  it("returns false for normal user", () => {
    repo.ensureUser("normal-1");
    expect(repo.isAdmin("normal-1")).toBe(false);
  });

  it("returns true for admin", () => {
    repo.setAdmin("admin-1", "im");
    expect(repo.isAdmin("admin-1")).toBe(true);
  });

  // ── listAdmins ───────────────────────────────────────────────────────

  it("lists admins ordered by source then userId", () => {
    repo.setAdmin("z-im-admin", "im");
    repo.seedEnvAdmins(["a-env-admin"]);
    repo.setAdmin("b-im-admin", "im");

    const admins = repo.listAdmins();
    expect(admins).toEqual([
      { userId: "a-env-admin", sysRole: 1, source: "env" },
      { userId: "b-im-admin", sysRole: 1, source: "im" },
      { userId: "z-im-admin", sysRole: 1, source: "im" },
    ]);
  });

  it("does not list normal users", () => {
    repo.ensureUser("normal-1");
    repo.setAdmin("admin-1", "im");
    expect(repo.listAdmins()).toHaveLength(1);
  });

  // ── setAdmin ─────────────────────────────────────────────────────────

  it("promotes normal user to admin", () => {
    repo.ensureUser("user-1");
    expect(repo.isAdmin("user-1")).toBe(false);
    repo.setAdmin("user-1", "im");
    expect(repo.isAdmin("user-1")).toBe(true);
  });

  it("is idempotent for repeated setAdmin", () => {
    repo.setAdmin("user-1", "im");
    repo.setAdmin("user-1", "im");
    expect(repo.listAdmins().filter(a => a.userId === "user-1")).toHaveLength(1);
  });

  // ── removeAdmin ──────────────────────────────────────────────────────

  it("removes runtime admin successfully", () => {
    repo.setAdmin("user-1", "im");
    const result = repo.removeAdmin("user-1");
    expect(result).toEqual({ ok: true });
    expect(repo.isAdmin("user-1")).toBe(false);
  });

  it("refuses to remove env admin", () => {
    repo.seedEnvAdmins(["env-1"]);
    const result = repo.removeAdmin("env-1");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("env");
    expect(repo.isAdmin("env-1")).toBe(true);
  });

  it("returns error for non-admin user", () => {
    repo.ensureUser("normal-1");
    const result = repo.removeAdmin("normal-1");
    expect(result.ok).toBe(false);
  });

  it("returns error for unknown user", () => {
    const result = repo.removeAdmin("nobody");
    expect(result.ok).toBe(false);
  });

  // ── ensureUser ───────────────────────────────────────────────────────

  it("creates normal user idempotently", () => {
    repo.ensureUser("user-1");
    repo.ensureUser("user-1"); // no error
    expect(repo.isAdmin("user-1")).toBe(false);
  });

  it("does not demote existing admin", () => {
    repo.setAdmin("admin-1", "im");
    repo.ensureUser("admin-1");
    expect(repo.isAdmin("admin-1")).toBe(true);
  });
});
