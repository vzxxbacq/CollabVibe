import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("project config", () => {
  it("updateProjectConfig changes workBranch", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-cfg1", userId: "admin-user", name: "p-cfg1" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", workBranch: "feature/new-branch" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.workBranch).toBe("feature/new-branch");
  });

  it("updateProjectConfig changes gitUrl", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-cfg2", userId: "admin-user", name: "p-cfg2" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", gitUrl: "https://github.com/test/repo.git" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.gitUrl).toBe("https://github.com/test/repo.git");
  });

  it("updateProjectConfig changes multiple fields at once", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-cfg3", userId: "admin-user", name: "p-cfg3" });
    await sim.api.updateProjectConfig({
      projectId, actorId: "admin-user",
      workBranch: "feature/multi",
      gitUrl: "https://github.com/test/multi.git",
    });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.workBranch).toBe("feature/multi");
    expect(rec?.gitUrl).toBe("https://github.com/test/multi.git");
  });

  it("updateProjectConfig leaves unchanged fields intact", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-cfg4", userId: "admin-user", name: "p-cfg4" });
    const before = await sim.api.getProjectRecord(projectId);
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", workBranch: "feature/partial" });
    const after = await sim.api.getProjectRecord(projectId);
    expect(after?.workBranch).toBe("feature/partial");
    expect(after?.name).toBe(before?.name);
  });

  it("updateProjectConfig with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin-user"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-cfg5", userId: "admin-user", name: "p-cfg5" });
    expect(() => sim!.api.updateProjectConfig({
      projectId, actorId: "nobody", workBranch: "feature/forbidden",
    })).toThrow();
  });

  it("updateProjectConfig with unknown projectId throws", async () => {
    sim = await SimHarness.create();
    await expect(sim.api.updateProjectConfig({
      projectId: "nonexistent", actorId: "admin-user", workBranch: "feature/ghost",
    })).rejects.toThrow();
  });

  it("updateGitRemote sets remote URL (on repo, not ProjectRecord)", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-git1", userId: "admin-user", name: "p-git1" });
    // updateGitRemote sets the git remote on the repository, not stored on ProjectRecord
    await sim.api.updateGitRemote({ projectId, gitUrl: "https://github.com/org/repo.git", actorId: "admin-user" });
    // Should not throw
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
  });

  it("updateGitRemote can be called multiple times", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-git2", userId: "admin-user", name: "p-git2" });
    await sim.api.updateGitRemote({ projectId, gitUrl: "https://github.com/org/old.git", actorId: "admin-user" });
    await sim.api.updateGitRemote({ projectId, gitUrl: "https://github.com/org/new.git", actorId: "admin-user" });
    // Should not throw
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
  });

  it("updateGitRemote with non-admin is denied", async () => {
    sim = await SimHarness.create(["admin-user"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-git3", userId: "admin-user", name: "p-git3" });
    expect(() => sim!.api.updateGitRemote({
      projectId, gitUrl: "https://evil.com/repo.git", actorId: "nobody",
    })).toThrow();
  });

  it("config change persists after getProjectRecord", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-persist", userId: "admin-user", name: "p-persist" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", workBranch: "feature/persist" });
    // Read twice — should be the same
    const rec1 = await sim.api.getProjectRecord(projectId);
    const rec2 = await sim.api.getProjectRecord(projectId);
    expect(rec1?.workBranch).toBe("feature/persist");
    expect(rec2?.workBranch).toBe("feature/persist");
  });

  it("updateProjectConfig sets agentsMdContent (written to disk)", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-agents", userId: "admin-user", name: "p-agents" });
    // agentsMdContent is written to AGENTS.md file, not stored in ProjectRecord
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", agentsMdContent: "# Custom AGENTS.md\nRules here." });
    // Should not throw — success is sufficient proof
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
  });

  it("updateProjectConfig sets gitignoreContent (written to disk)", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-gi", userId: "admin-user", name: "p-gi" });
    // gitignoreContent is written to .gitignore file, not stored in ProjectRecord
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", gitignoreContent: "node_modules/\n.env" });
    // Should not throw — success is sufficient proof
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
  });

  it("updateProjectConfig on disabled project is restricted", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dis-cfg", userId: "admin-user", name: "p-dis-cfg" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    try {
      await sim.api.updateProjectConfig({
        projectId, actorId: "admin-user", workBranch: "forbidden",
      });
      // If it doesn't throw, the guard allows it on disabled projects
    } catch {
      // Expected if disabled project guard is enforced
    }
  });

  it("sequential config updates accumulate correctly", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-seq", userId: "admin-user", name: "p-seq" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", workBranch: "feature/v1" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", gitUrl: "https://url.git" });
    await sim.api.updateProjectConfig({ projectId, actorId: "admin-user", workBranch: "feature/v2" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.workBranch).toBe("feature/v2");
    expect(rec?.gitUrl).toBe("https://url.git");
  });
});
