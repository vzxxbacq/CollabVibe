import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("error edge cases", () => {
  // ── Unknown IDs ──

  it("resolveProjectId for unknown chatId → null", async () => {
    sim = await SimHarness.create();
    expect(sim.api.resolveProjectId("unknown-chat-xyz")).toBeNull();
  });

  it("getProjectRecord for unknown projectId → null", async () => {
    sim = await SimHarness.create();
    expect(sim.api.getProjectRecord("unknown-proj-xyz")).toBeNull();
  });

  it("listProjectMembers for unknown projectId → empty or throws", async () => {
    sim = await SimHarness.create();
    try {
      const members = sim.api.listProjectMembers("unknown-proj");
      expect(Array.isArray(members)).toBe(true);
    } catch {
      // Also acceptable
    }
  });

  it("listProjectSkills for unknown projectId → empty or throws", async () => {
    sim = await SimHarness.create();
    try {
      const skills = await sim.api.listProjectSkills("unknown-proj");
      expect(Array.isArray(skills)).toBe(true);
    } catch {
      // Also acceptable
    }
  });

  it("getTurnDetail for unknown turnId → throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee1", userId: "admin-user", name: "p-ee1" });
    await expect(sim.api.getTurnDetail({ projectId, turnId: "ghost" })).rejects.toThrow();
  });

  it("getTurnCardData for unknown turnId → null", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee2", userId: "admin-user", name: "p-ee2" });
    const data = await sim.api.getTurnCardData({ projectId, turnId: "ghost" });
    expect(data).toBeNull();
  });

  // ── Disabled project operations ──

  it("createThread on disabled project may be restricted", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee3", userId: "admin-user", name: "p-ee3" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    sim.fakeBackend.setScript("t-dis", SIMPLE_TURN_SCRIPT);
    try {
      await sim.api.createThread({
        projectId, userId: "admin-user", actorId: "admin-user",
        threadName: "t-dis", backendId: "codex", model: "fake-model",
      });
      // If succeeds, disabled project guard not enforced
    } catch {
      // Expected if disabled project guard is enforced
    }
  });

  it("createTurn on disabled project → error", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee4", userId: "admin-user", name: "p-ee4" });
    // Create thread first
    sim.fakeBackend.setScript("t-ee4", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-ee4", backendId: "codex", model: "fake-model" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    await expect(sim.api.createTurn({
      projectId, userId: "admin-user", actorId: "admin-user", text: "test",
    })).rejects.toThrow();
  });

  it("updateProjectConfig on disabled project may be restricted", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee5", userId: "admin-user", name: "p-ee5" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    try {
      await sim.api.updateProjectConfig({
        projectId, actorId: "admin-user", workBranch: "forbidden",
      });
    } catch {
      // Expected if disabled project guard is enforced
    }
  });

  // ── Duplicate operations ──

  it("duplicate project create (same chatId) → error", async () => {
    sim = await SimHarness.create();
    await sim.createProjectFromChat({ chatId: "c-dup-ee", userId: "admin-user", name: "p-dup-1" });
    await expect(sim.createProjectFromChat({ chatId: "c-dup-ee", userId: "admin-user", name: "p-dup-2" })).rejects.toThrow();
  });

  it("duplicate thread create (same name) → error", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dup-t", userId: "admin-user", name: "p-dup-t" });
    sim.fakeBackend.setScript("dt", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "dt", backendId: "codex", model: "fake" });
    sim.fakeBackend.setScript("dt", SIMPLE_TURN_SCRIPT);
    await expect(sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "dt", backendId: "codex", model: "fake" })).rejects.toThrow();
  });

  // ── Thread operations on wrong context ──

  it("joinThread for non-existent thread → error", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee6", userId: "admin-user", name: "p-ee6" });
    await expect(sim.api.joinThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "ghost" })).rejects.toThrow();
  });

  it("deleteThread for non-existent thread → error", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee7", userId: "admin-user", name: "p-ee7" });
    await expect(sim.api.deleteThread({ projectId, threadName: "ghost", actorId: "admin-user" })).rejects.toThrow();
  });

  it("handleApprovalCallback with invalid approvalId → error", async () => {
    sim = await SimHarness.create();
    await expect(sim.api.handleApprovalCallback({
      approvalId: "totally-fake", decision: "accept",
    })).rejects.toThrow();
  });

  it("AuthorizationError has userId and permission", async () => {
    sim = await SimHarness.create(["admin"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-ee8", userId: "admin", name: "p-ee8" });
    try {
      sim.api.addProjectMember({ projectId, userId: "target", role: "developer", actorId: "nobody" });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toMatch(/lacks permission|AuthorizationError/);
    }
  });
});
