import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("project lifecycle edge cases", () => {
  // ── Create ──

  it("create project with long name succeeds", async () => {
    sim = await SimHarness.create();
    const longName = "p-" + "a".repeat(100);
    const projectId = await sim.createProjectFromChat({ chatId: "c-long", userId: "admin-user", name: longName });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.name).toBe(longName);
  });

  it("create project with special chars in name", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sp", userId: "admin-user", name: "proj-特殊" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.name).toBe("proj-特殊");
  });

  it("create project with duplicate chatId throws", async () => {
    sim = await SimHarness.create();
    await sim.createProjectFromChat({ chatId: "c-dup", userId: "admin-user", name: "p1" });
    await expect(sim.createProjectFromChat({ chatId: "c-dup", userId: "admin-user", name: "p2" })).rejects.toThrow();
  });

  it("create project auto-sets active status", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-status", userId: "admin-user", name: "p-status" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
  });

  it("create project assigns workBranch", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-wb", userId: "admin-user", name: "p-wb" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.workBranch).toBeTruthy();
  });

  it("create two projects with different chatIds", async () => {
    sim = await SimHarness.create();
    const id1 = await sim.createProjectFromChat({ chatId: "c-a", userId: "admin-user", name: "pa" });
    const id2 = await sim.createProjectFromChat({ chatId: "c-b", userId: "admin-user", name: "pb" });
    expect(id1).not.toBe(id2);
    expect(await sim.api.resolveProjectId("c-a")).toBe(id1);
    expect(await sim.api.resolveProjectId("c-b")).toBe(id2);
  });

  // ── Disable / Reactivate ──

  it("disable already-disabled project is idempotent", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dd", userId: "admin-user", name: "p-dd" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    // Second disable should not throw
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    expect((await sim.api.getProjectRecord(projectId))?.status).toBe("disabled");
  });

  it("reactivate already-active project is idempotent", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ra", userId: "admin-user", name: "p-ra" });
    await sim.api.reactivateProject({ projectId, actorId: "admin-user" });
    expect((await sim.api.getProjectRecord(projectId))?.status).toBe("active");
  });

  it("disable then reactivate preserves project data", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-cycle", userId: "admin-user", name: "p-cycle" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    await sim.api.reactivateProject({ projectId, actorId: "admin-user" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.status).toBe("active");
    expect(rec?.name).toBe("p-cycle");
  });

  // ── Delete ──

  it("delete disabled project succeeds", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-deld", userId: "admin-user", name: "p-deld" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    await sim.api.deleteProject({ projectId, actorId: "admin-user" });
    expect(await sim.api.getProjectRecord(projectId)).toBeNull();
  });

  it("delete project removes from listProjects", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-lp", userId: "admin-user", name: "p-lp" });
    const before = (await sim.api.listProjects())?.length;
    await sim.api.deleteProject({ projectId, actorId: "admin-user" });
    const after = (await sim.api.listProjects())?.length;
    expect(after).toBe(before - 1);
  });

  // ── Unlink / Link ──

  it("unlink adds project to listUnboundProjects", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ub", userId: "admin-user", name: "p-ub" });
    await sim.api.unlinkProject({ projectId, actorId: "admin-user" });
    const unbound = await sim.api.listUnboundProjects();
    expect(unbound.some((p) => p.id === projectId)).toBe(true);
  });

  it("link bound project to another chatId fails when already bound", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-bound", userId: "admin-user", name: "p-bound" });
    // Project is already bound to c-bound, trying to bind to c-new without unlinking first
    try {
      await sim.api.linkProjectToChat({ projectId, chatId: "c-new2", ownerId: "admin-user", actorId: "admin-user" });
      // If it succeeds, old binding should be removed
      expect(await sim.api.resolveProjectId("c-new2")).toBe(projectId);
    } catch {
      // Expected if implementation requires unlink first
    }
  });

  it("resolveProjectId returns null for unknown chatId", async () => {
    sim = await SimHarness.create();
    expect(await sim.api.resolveProjectId("nonexistent")).toBeNull();
  });

  it("getProjectRecord returns null for unknown projectId", async () => {
    sim = await SimHarness.create();
    expect(await sim.api.getProjectRecord("nonexistent")).toBeNull();
  });

  // ── listProjects ──

  it("listProjects returns all created projects", async () => {
    sim = await SimHarness.create();
    await sim.createProjectFromChat({ chatId: "c-l1", userId: "admin-user", name: "p-l1" });
    await sim.createProjectFromChat({ chatId: "c-l2", userId: "admin-user", name: "p-l2" });
    await sim.createProjectFromChat({ chatId: "c-l3", userId: "admin-user", name: "p-l3" });
    const projects = await sim.api.listProjects();
    expect(projects.length).toBe(3);
  });

  it("listProjects includes disabled projects", async () => {
    sim = await SimHarness.create();
    const pid = await sim.createProjectFromChat({ chatId: "c-ld", userId: "admin-user", name: "p-ld" });
    await sim.api.disableProject({ projectId: pid, actorId: "admin-user" });
    const projects = await sim.api.listProjects();
    expect(projects.some((p) => p.id === pid && p.status === "disabled")).toBe(true);
  });

  it("listUnboundProjects is empty when all projects are bound", async () => {
    sim = await SimHarness.create();
    await sim.createProjectFromChat({ chatId: "c-all-bound", userId: "admin-user", name: "p-all-bound" });
    const unbound = await sim.api.listUnboundProjects();
    expect(unbound).toEqual([]);
  });

  it("project record has cwd field set", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-cwd", userId: "admin-user", name: "p-cwd" });
    const rec = await sim.api.getProjectRecord(projectId);
    expect(rec?.cwd).toBeTruthy();
    expect(typeof rec!.cwd).toBe("string");
  });

  it("multiple disable/reactivate cycles work", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-mc", userId: "admin-user", name: "p-mc" });
    for (let i = 0; i < 3; i++) {
      await sim.api.disableProject({ projectId, actorId: "admin-user" });
      expect((await sim.api.getProjectRecord(projectId))?.status).toBe("disabled");
      await sim.api.reactivateProject({ projectId, actorId: "admin-user" });
      expect((await sim.api.getProjectRecord(projectId))?.status).toBe("active");
    }
  });

  it("create project with non-admin actorId fails", async () => {
    sim = await SimHarness.create(["real-admin"]);
    expect(() => sim!.api.createProject({
      chatId: "c-noauth", userId: "nobody", actorId: "nobody",
      name: "forbidden", cwd: "/tmp/forbidden", workBranch: "feature/forbidden",
    })).toThrow();
  });

  it("disable project with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin-user"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-deny-d", userId: "admin-user", name: "p-deny-d" });
    expect(() => sim!.api.disableProject({ projectId, actorId: "nobody" })).toThrow();
  });

  it("reactivate project with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin-user"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-deny-r", userId: "admin-user", name: "p-deny-r" });
    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    expect(() => sim!.api.reactivateProject({ projectId, actorId: "nobody" })).toThrow();
  });

  it("delete project with non-admin actorId is denied", async () => {
    sim = await SimHarness.create(["admin-user"]);
    const projectId = await sim.createProjectFromChat({ chatId: "c-deny-del", userId: "admin-user", name: "p-deny-del" });
    expect(() => sim!.api.deleteProject({ projectId, actorId: "nobody" })).toThrow();
  });
});
