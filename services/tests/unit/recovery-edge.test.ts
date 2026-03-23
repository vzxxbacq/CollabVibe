import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("recovery edge cases", () => {
  it("project data survives multiple disable/reactivate cycles", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rec1", userId: "admin-user", name: "p-rec1" });
    for (let i = 0; i < 3; i++) {
      await sim.api.disableProject({ projectId, actorId: "admin-user" });
      await sim.api.reactivateProject({ projectId, actorId: "admin-user" });
    }
    const rec = sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
    expect(rec?.name).toBe("p-rec1");
  });

  it("thread data persists after turn complete", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rec2", userId: "admin-user", name: "p-rec2" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-rec2", userId: "admin-user",
      threadName: "t-rec2", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin-user" });
    expect(threads.some((t: any) => t.threadName === "t-rec2")).toBe(true);
  });

  it("admin list persists after add/remove cycles", async () => {
    sim = await SimHarness.create(["root-admin"]);
    sim.api.addAdmin("cycle-admin");
    sim.api.removeAdmin("cycle-admin");
    sim.api.addAdmin("cycle-admin");
    expect(sim.api.isAdmin("cycle-admin")).toBe(true);
  });

  it("project member list persists after modifications", async () => {
    sim = await SimHarness.create(["owner"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-rec3", userId: "owner", name: "p-rec3" });
    sim.api.addProjectMember({ projectId, userId: "dev", role: "developer", actorId: "owner" });
    sim.api.updateProjectMemberRole({ projectId, userId: "dev", role: "maintainer", actorId: "owner" });
    const members = sim.api.listProjectMembers(projectId);
    expect(members.some((m) => m.userId === "dev" && m.role === "maintainer")).toBe(true);
  });

  it("turn data queryable after complete", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rec4", userId: "admin-user", name: "p-rec4" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-rec4", userId: "admin-user",
      threadName: "t-rec4", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    // Turn outputs are queryable via platform
    const outputs = sim.platform.listOutputs("c-rec4");
    expect(outputs.length).toBeGreaterThan(0);
  });

  it("skill bindings persist after operations", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rec5", userId: "admin-user", name: "p-rec5" });
    await sim.installLocalSkillFromChat({ chatId: "c-rec5", actorId: "admin-user", projectId, skillName: "persist-skill" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.some((s: any) => s.pluginName === "persist-skill")).toBe(true);
  });

  it("user records persist after operations", async () => {
    sim = await SimHarness.create(["admin"]);
    sim.api.addAdmin("persisted-user");
    const users = sim.api.listUsers();
    expect(users.users.some((u) => u.userId === "persisted-user")).toBe(true);
  });

  it("config changes persist across reads", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rec6", userId: "admin-user", name: "p-rec6" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", workBranch: "feature/persistent" });
    const rec1 = sim.api.getProjectRecord(projectId);
    const rec2 = sim.api.getProjectRecord(projectId);
    expect(rec1?.workBranch).toBe("feature/persistent");
    expect(rec2?.workBranch).toBe("feature/persistent");
  });

  it("multiple operations don't corrupt state", async () => {
    sim = await SimHarness.create(["admin"]);
    const pid1 = await sim.createProjectFromChat({ chatId: "c-rec7a", userId: "admin", name: "p-rec7a" });
    const pid2 = await sim.createProjectFromChat({ chatId: "c-rec7b", userId: "admin", name: "p-rec7b" });
    sim.api.addProjectMember({ projectId: pid1, userId: "user-a", role: "developer", actorId: "admin" });
    sim.api.addProjectMember({ projectId: pid2, userId: "user-b", role: "auditor", actorId: "admin" });
    
    expect(sim.api.listProjectMembers(pid1).some((m) => m.userId === "user-a")).toBe(true);
    expect(sim.api.listProjectMembers(pid2).some((m) => m.userId === "user-b")).toBe(true);
    expect(sim.api.listProjectMembers(pid1).some((m) => m.userId === "user-b")).toBe(false);
    expect(sim.api.listProjectMembers(pid2).some((m) => m.userId === "user-a")).toBe(false);
  });

  it("resolveProjectId consistent after many operations", async () => {
    sim = await SimHarness.create();
    const pid = await sim.createProjectFromChat({ chatId: "c-rec8", userId: "admin-user", name: "p-rec8" });
    // Do many operations
    await sim.api.updateProjectConfig({ projectId: pid, actorId: "admin-user", workBranch: "feature/x" });
    sim.api.addAdmin("extra");
    sim.api.addProjectMember({ projectId: pid, userId: "extra", role: "developer", actorId: "admin-user" });
    
    // resolveProjectId should still work
    expect(sim.api.resolveProjectId("c-rec8")).toBe(pid);
  });
});
