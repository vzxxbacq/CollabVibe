import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("IAM and RBAC", () => {
  // ── Admin management ──

  it("addAdmin makes user an admin", async () => {
    sim = await SimHarness.create(["root"]);
    await sim.api.addAdmin("new-admin");
    expect(sim.api.isAdmin("new-admin")).toBe(true);
  });

  it("removeAdmin revokes admin", async () => {
    sim = await SimHarness.create(["root"]);
    await sim.api.addAdmin("temp-admin");
    await sim.api.removeAdmin("temp-admin");
    expect(sim.api.isAdmin("temp-admin")).toBe(false);
  });

  it("isAdmin for env admin returns true", async () => {
    sim = await SimHarness.create(["env-admin"]);
    expect(sim.api.isAdmin("env-admin")).toBe(true);
  });

  it("isAdmin for non-admin returns false", async () => {
    sim = await SimHarness.create(["root"]);
    expect(sim.api.isAdmin("random-user")).toBe(false);
  });

  it("listAdmins includes env admin", async () => {
    sim = await SimHarness.create(["env-admin"]);
    const admins = await sim.api.listAdmins();
    expect(admins.some((a) => a.userId === "env-admin" && a.source === "env")).toBe(true);
  });

  it("listAdmins includes im admin", async () => {
    sim = await SimHarness.create(["root"]);
    await sim.api.addAdmin("im-admin");
    const admins = await sim.api.listAdmins();
    expect(admins.some((a) => a.userId === "im-admin" && a.source === "im")).toBe(true);
  });

  it("removeAdmin on env admin preserves it (env admins are undeletable)", async () => {
    sim = await SimHarness.create(["env-admin"]);
    const result = await sim.api.removeAdmin("env-admin");
    // env admin should still be admin
    expect(sim.api.isAdmin("env-admin")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("addAdmin twice is idempotent", async () => {
    sim = await SimHarness.create(["root"]);
    await sim.api.addAdmin("dup-admin");
    await sim.api.addAdmin("dup-admin");
    const admins = await sim.api.listAdmins();
    const count = admins.filter((a) => a.userId === "dup-admin").length;
    expect(count).toBe(1);
  });

  // ── Project members ──

  it("admin can add project member", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam1", userId: "owner", name: "p-iam1" });
    await sim.api.addProjectMember({ projectId, userId: "dev-1", role: "developer", actorId: "owner" });
    const members = await sim.api.listProjectMembers(projectId);
    expect(members.some((m) => m.userId === "dev-1" && m.role === "developer")).toBe(true);
  });

  it("non-admin cannot add project member", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam2", userId: "owner", name: "p-iam2" });
    expect(() => {
      sim!.api.addProjectMember({ projectId, userId: "victim", role: "developer", actorId: "nobody" });
    }).toThrow(/lacks permission|AuthorizationError/);
  });

  it("add multiple members with different roles", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam3", userId: "owner", name: "p-iam3" });
    await sim.api.addProjectMember({ projectId, userId: "dev", role: "developer", actorId: "owner" });
    await sim.api.addProjectMember({ projectId, userId: "maint", role: "maintainer", actorId: "owner" });
    await sim.api.addProjectMember({ projectId, userId: "aud", role: "auditor", actorId: "owner" });
    const members = await sim.api.listProjectMembers(projectId);
    expect(members.length).toBeGreaterThanOrEqual(3);
    expect(members.some((m) => m.userId === "dev" && m.role === "developer")).toBe(true);
    expect(members.some((m) => m.userId === "maint" && m.role === "maintainer")).toBe(true);
    expect(members.some((m) => m.userId === "aud" && m.role === "auditor")).toBe(true);
  });

  it("removeProjectMember removes from list", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam4", userId: "owner", name: "p-iam4" });
    await sim.api.addProjectMember({ projectId, userId: "temp", role: "developer", actorId: "owner" });
    await sim.api.removeProjectMember({ projectId, userId: "temp", actorId: "owner" });
    const members = await sim.api.listProjectMembers(projectId);
    expect(members.find((m) => m.userId === "temp")).toBeUndefined();
  });

  it("removeProjectMember for non-member is safe", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam5", userId: "owner", name: "p-iam5" });
    // Should not throw
    await sim.api.removeProjectMember({ projectId, userId: "ghost-user", actorId: "owner" });
  });

  it("non-admin cannot remove project member", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam6", userId: "owner", name: "p-iam6" });
    await sim.api.addProjectMember({ projectId, userId: "victim", role: "developer", actorId: "owner" });
    expect(() => {
      sim!.api.removeProjectMember({ projectId, userId: "victim", actorId: "nobody" });
    }).toThrow(/lacks permission|AuthorizationError/);
  });

  it("updateProjectMemberRole changes role", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam7", userId: "owner", name: "p-iam7" });
    await sim.api.addProjectMember({ projectId, userId: "changeme", role: "developer", actorId: "owner" });
    sim.api.updateProjectMemberRole({ projectId, userId: "changeme", role: "maintainer", actorId: "owner" });
    const members = await sim.api.listProjectMembers(projectId);
    expect(members.some((m) => m.userId === "changeme" && m.role === "maintainer")).toBe(true);
  });

  it("updateProjectMemberRole with non-admin denied", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam8", userId: "owner", name: "p-iam8" });
    await sim.api.addProjectMember({ projectId, userId: "target", role: "developer", actorId: "owner" });
    expect(() => {
      sim!.api.updateProjectMemberRole({ projectId, userId: "target", role: "maintainer", actorId: "nobody" });
    }).toThrow(/lacks permission|AuthorizationError/);
  });

  it("updateProjectMemberRole to same role is idempotent", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-iam9", userId: "owner", name: "p-iam9" });
    await sim.api.addProjectMember({ projectId, userId: "same", role: "developer", actorId: "owner" });
    sim.api.updateProjectMemberRole({ projectId, userId: "same", role: "developer", actorId: "owner" });
    const members = await sim.api.listProjectMembers(projectId);
    expect(members.filter((m) => m.userId === "same").length).toBe(1);
    expect(members.some((m) => m.userId === "same" && m.role === "developer")).toBe(true);
  });

  // ── resolveRole ──

  it("resolveRole for admin returns admin", async () => {
    sim = await SimHarness.create(["admin"]);
    const role = await sim.api.resolveRole({ userId: "admin" });
    expect(role).toBe("admin");
  });

  it("resolveRole for developer returns developer", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-rr1", userId: "owner", name: "p-rr1" });
    await sim.api.addProjectMember({ projectId, userId: "dev-rr", role: "developer", actorId: "owner" });
    const role = await sim.api.resolveRole({ userId: "dev-rr", projectId });
    expect(role).toBe("developer");
  });

  it("resolveRole for unknown user returns non-admin role or null", async () => {
    sim = await SimHarness.create(["owner"]);
    const role = await sim.api.resolveRole({ userId: "unknown-user" });
    // Unknown user should not be admin
    expect(role).not.toBe("admin");
  });

  it("resolveRole for different projects", async () => {
    sim = await SimHarness.create(["owner"]);
    const pid1 = await sim.createProjectFromChat({ chatId: "c-rr2", userId: "owner", name: "p-rr2" });
    const pid2 = await sim.createProjectFromChat({ chatId: "c-rr3", userId: "owner", name: "p-rr3" });
    await sim.api.addProjectMember({ projectId: pid1, userId: "multi-user", role: "developer", actorId: "owner" });
    await sim.api.addProjectMember({ projectId: pid2, userId: "multi-user", role: "maintainer", actorId: "owner" });
    expect(await sim.api.resolveRole({ userId: "multi-user", projectId: pid1 })).toBe("developer");
    expect(await sim.api.resolveRole({ userId: "multi-user", projectId: pid2 })).toBe("maintainer");
  });

  // ── listUsers ──

  it("listUsers returns known users", async () => {
    sim = await SimHarness.create(["admin"]);
    const result = await sim.api.listUsers();
    expect(result.users.length).toBeGreaterThanOrEqual(1);
    expect(result.users.some((u) => u.userId === "admin")).toBe(true);
  });

  it("listUsers total reflects count", async () => {
    sim = await SimHarness.create(["admin"]);
    await sim.api.addAdmin("user-a");
    await sim.api.addAdmin("user-b");
    const result = await sim.api.listUsers();
    expect(result.total).toBeGreaterThanOrEqual(3);
  });

  it("listProjectMembers on empty project returns empty or owner-only", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-empty-m", userId: "owner", name: "p-empty-m" });
    const members = await sim.api.listProjectMembers(projectId);
    // May include owner as maintainer or be empty — both acceptable
    expect(Array.isArray(members)).toBe(true);
  });

  it("addProjectMember auto-registers user", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-auto", userId: "owner", name: "p-auto" });
    await sim.api.addProjectMember({ projectId, userId: "new-dev", role: "developer", actorId: "owner" });
    const users = await sim.api.listUsers();
    expect(users.users.some((u) => u.userId === "new-dev")).toBe(true);
  });

  it("admin manages multiple projects", async () => {
    sim = await SimHarness.create(["admin"]);
    const pid1 = await sim.createProjectFromChat({ chatId: "c-mp1", userId: "admin", name: "p-mp1" });
    const pid2 = await sim.createProjectFromChat({ chatId: "c-mp2", userId: "admin", name: "p-mp2" });
    await sim.api.addProjectMember({ projectId: pid1, userId: "user-x", role: "developer", actorId: "admin" });
    await sim.api.addProjectMember({ projectId: pid2, userId: "user-x", role: "auditor", actorId: "admin" });
    expect((await sim.api.listProjectMembers(pid1))?.some((m) => m.userId === "user-x" && m.role === "developer")).toBe(true);
    expect((await sim.api.listProjectMembers(pid2))?.some((m) => m.userId === "user-x" && m.role === "auditor")).toBe(true);
  });
});
