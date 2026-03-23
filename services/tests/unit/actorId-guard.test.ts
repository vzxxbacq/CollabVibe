import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("actorId guard enforcement", () => {
  // ── Project operations ──

  it("createProject with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["real-admin"]);
    expect(() => sim!.api.createProject({
      chatId: "c-guard1", userId: "nobody", actorId: "nobody",
      name: "forbidden", cwd: "/tmp/forbidden", workBranch: "feature/forbidden",
    })).toThrow();
  });

  it("deleteProject with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard2", userId: "admin", name: "p-guard2" });
    expect(() => sim!.api.deleteProject({ projectId, actorId: "nobody" })).toThrow();
  });

  it("disableProject with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard3", userId: "admin", name: "p-guard3" });
    expect(() => sim!.api.disableProject({ projectId, actorId: "nobody" })).toThrow();
  });

  it("reactivateProject with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard4", userId: "admin", name: "p-guard4" });
    await sim.api.disableProject({ projectId, actorId: "admin" });
    expect(() => sim!.api.reactivateProject({ projectId, actorId: "nobody" })).toThrow();
  });

  it("unlinkProject with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard5", userId: "admin", name: "p-guard5" });
    expect(() => sim!.api.unlinkProject({ projectId, actorId: "nobody" })).toThrow();
  });

  it("updateProjectConfig with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard6", userId: "admin", name: "p-guard6" });
    expect(() => sim!.api.updateProjectConfig({
      projectId, actorId: "nobody", workBranch: "invalid",
    })).toThrow();
  });

  it("updateGitRemote with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard7", userId: "admin", name: "p-guard7" });
    expect(() => sim!.api.updateGitRemote({
      projectId, gitUrl: "https://evil.com", actorId: "nobody",
    })).toThrow();
  });

  // ── IAM operations ──

  it("addProjectMember with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard8", userId: "admin", name: "p-guard8" });
    expect(() => {
      sim!.api.addProjectMember({ projectId, userId: "victim", role: "developer", actorId: "nobody" });
    }).toThrow();
  });

  it("removeProjectMember with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard9", userId: "admin", name: "p-guard9" });
    sim.api.addProjectMember({ projectId, userId: "member", role: "developer", actorId: "admin" });
    expect(() => {
      sim!.api.removeProjectMember({ projectId, userId: "member", actorId: "nobody" });
    }).toThrow();
  });

  it("updateProjectMemberRole with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard10", userId: "admin", name: "p-guard10" });
    sim.api.addProjectMember({ projectId, userId: "target", role: "developer", actorId: "admin" });
    expect(() => {
      sim!.api.updateProjectMemberRole({ projectId, userId: "target", role: "maintainer", actorId: "nobody" });
    }).toThrow();
  });

  // ── Admin actorId passes all guards ──

  it("admin actorId can create project", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok1", userId: "admin", name: "p-ok1" });
    const rec = sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
  });

  it("admin actorId can disable project", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok2", userId: "admin", name: "p-ok2" });
    await sim.api.disableProject({ projectId, actorId: "admin" });
    expect(sim.api.getProjectRecord(projectId)?.status).toBe("disabled");
  });

  it("admin actorId can addProjectMember", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok3", userId: "admin", name: "p-ok3" });
    sim.api.addProjectMember({ projectId, userId: "new-dev", role: "developer", actorId: "admin" });
    const members = sim.api.listProjectMembers(projectId);
    expect(members.some((m) => m.userId === "new-dev")).toBe(true);
  });

  it("admin actorId can updateProjectConfig", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok4", userId: "admin", name: "p-ok4" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin", workBranch: "feature/ok4" });
    expect(sim.api.getProjectRecord(projectId)?.workBranch).toBe("feature/ok4");
  });

  it("admin actorId can deleteProject", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok5", userId: "admin", name: "p-ok5" });
    await sim.api.deleteProject({ projectId, actorId: "admin" });
    expect(sim.api.getProjectRecord(projectId)).toBeNull();
  });

  it("admin actorId can install skill", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok6", userId: "admin", name: "p-ok6" });
    await sim.installLocalSkillFromChat({ chatId: "c-guard-ok6", actorId: "admin", projectId, skillName: "ok-skill" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.some((s: any) => s.pluginName === "ok-skill")).toBe(true);
  });

  it("admin actorId can remove skill", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok7", userId: "admin", name: "p-ok7" });
    await sim.installLocalSkillFromChat({ chatId: "c-guard-ok7", actorId: "admin", projectId, skillName: "rm-ok-skill" });
    await sim.removeLocalSkillFromChat({ chatId: "c-guard-ok7", actorId: "admin", projectId, skillName: "rm-ok-skill" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.length).toBe(0);
  });

  it("admin actorId can create and delete thread", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok8", userId: "admin", name: "p-ok8" });
    sim.fakeBackend.setScript("guard-t", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({
      projectId, userId: "admin", actorId: "admin",
      threadName: "guard-t", backendId: "codex", model: "fake-model",
    });
    await sim.api.deleteThread({ projectId, threadName: "guard-t", actorId: "admin" });
    const threads = await sim.api.listThreads({ projectId, actorId: "admin" });
    expect(threads.some((t: any) => t.threadName === "guard-t")).toBe(false);
  });

  it("admin actorId passes merge operations", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-guard-ok9", userId: "admin", name: "p-ok9" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-guard-ok9", userId: "admin",
      threadName: "merge-guard-t", threadId: "", turnId: "",
      script: SIMPLE_TURN_SCRIPT,
    });
    // Merge with admin actorId — should not throw auth error
    try {
      await sim.api.handleMerge({
        projectId, branchName: "merge-guard-t", actorId: "admin",
      });
    } catch (e: any) {
      // Should NOT be an authorization error
      expect(e.message).not.toMatch(/lacks permission|AuthorizationError/);
    }
  });
});
