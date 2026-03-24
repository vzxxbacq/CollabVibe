import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("user management", () => {
  it("admin can add and remove another admin", async () => {
    sim = await SimHarness.create(["owner-1"]);
    await sim.createProjectFromChat({ chatId: "c-admin", userId: "owner-1", name: "p-admin" });

    await sim.api.addAdmin("ops-1");
    expect(sim.api.isAdmin("ops-1")).toBe(true);

    await sim.api.removeAdmin("ops-1");
    expect(sim.api.isAdmin("ops-1")).toBe(false);
  });

  it("addProjectMember and listProjectMembers", async () => {
    sim = await SimHarness.create(["owner-1"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-member", userId: "owner-1", name: "p-member" });

    // actorId = owner-1 (admin), userId = target user to add
    await sim.api.addProjectMember({ projectId, userId: "dev-1", role: "developer", actorId: "owner-1" });
    await sim.api.addProjectMember({ projectId, userId: "aud-1", role: "auditor", actorId: "owner-1" });

    const members = await sim.api.listProjectMembers(projectId);
    expect(members).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "dev-1", role: "developer" }),
      expect.objectContaining({ userId: "aud-1", role: "auditor" }),
    ]));
  });

  it("updateProjectMemberRole changes role", async () => {
    sim = await SimHarness.create(["owner-1"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-role", userId: "owner-1", name: "p-role" });

    await sim.api.addProjectMember({ projectId, userId: "dev-2", role: "developer", actorId: "owner-1" });
    sim.api.updateProjectMemberRole({ projectId, userId: "dev-2", role: "maintainer", actorId: "owner-1" });

    const members = await sim.api.listProjectMembers(projectId);
    expect(members).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: "dev-2", role: "maintainer" }),
    ]));
  });

  it("removeProjectMember removes from list", async () => {
    sim = await SimHarness.create(["owner-1"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-rm", userId: "owner-1", name: "p-rm" });

    await sim.api.addProjectMember({ projectId, userId: "tmp-1", role: "developer", actorId: "owner-1" });
    await sim.api.removeProjectMember({ projectId, userId: "tmp-1", actorId: "owner-1" });

    const members = await sim.api.listProjectMembers(projectId);
    expect(members.find((m: any) => m.userId === "tmp-1")).toBeUndefined();
  });

  it("listUsers returns all known users", async () => {
    sim = await SimHarness.create(["admin-user"]);
    await sim.createProjectFromChat({ chatId: "c-users", userId: "admin-user", name: "p-users" });

    await sim.api.addAdmin("extra-admin");
    const result = await sim.api.listUsers();
    expect(result.users.map((u: any) => u.userId)).toEqual(expect.arrayContaining(["admin-user", "extra-admin"]));
  });

  it("listAdmins includes env and im admins", async () => {
    sim = await SimHarness.create(["env-admin"]);
    await sim.api.addAdmin("im-admin");

    const admins = await sim.api.listAdmins();
    const ids = admins.map((a: any) => a.userId);
    expect(ids).toContain("env-admin");
    expect(ids).toContain("im-admin");
  });

  it("non-admin cannot addProjectMember", async () => {
    sim = await SimHarness.create(["owner-1"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-noauth", userId: "owner-1", name: "p-noauth" });

    // actorId = non-admin user → should fail
    expect(() => {
      sim!.api.addProjectMember({ projectId, userId: "someone", role: "developer", actorId: "nobody" });
    }).toThrow(/lacks permission|AuthorizationError/);
  });
});
