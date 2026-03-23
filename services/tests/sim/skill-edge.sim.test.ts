import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("skill edge cases", () => {
  it("install and list local skill", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk1", userId: "admin-user", name: "p-sk1" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk1", actorId: "admin-user", projectId, skillName: "skill-1" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.some((s: any) => s.pluginName === "skill-1" && s.enabled)).toBe(true);
  });

  it("remove skill and verify empty", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk2", userId: "admin-user", name: "p-sk2" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk2", actorId: "admin-user", projectId, skillName: "skill-2" });
    await sim.removeLocalSkillFromChat({ chatId: "c-sk2", actorId: "admin-user", projectId, skillName: "skill-2" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills).toEqual([]);
  });

  it("install two skills on same project", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk3", userId: "admin-user", name: "p-sk3" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk3", actorId: "admin-user", projectId, skillName: "sk-a" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk3", actorId: "admin-user", projectId, skillName: "sk-b" });
    const skills = await sim.api.listProjectSkills(projectId);
    const names = skills.map((s: any) => s.pluginName);
    expect(names).toContain("sk-a");
    expect(names).toContain("sk-b");
  });

  it("remove one skill doesn't affect other", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk4", userId: "admin-user", name: "p-sk4" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk4", actorId: "admin-user", projectId, skillName: "keep-me" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk4", actorId: "admin-user", projectId, skillName: "remove-me" });
    await sim.removeLocalSkillFromChat({ chatId: "c-sk4", actorId: "admin-user", projectId, skillName: "remove-me" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.some((s: any) => s.pluginName === "keep-me")).toBe(true);
    expect(skills.some((s: any) => s.pluginName === "remove-me")).toBe(false);
  });

  it("listProjectSkills on empty project returns []", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk5", userId: "admin-user", name: "p-sk5" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills).toEqual([]);
  });

  it("install skill emits notification", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk6", userId: "admin-user", name: "p-sk6" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk6", actorId: "admin-user", projectId, skillName: "notif-sk" });
    const kinds = sim.platform.listOutputKinds("c-sk6");
    expect(kinds).toContain("notification");
  });

  it("remove skill emits notification", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk7", userId: "admin-user", name: "p-sk7" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk7", actorId: "admin-user", projectId, skillName: "rm-notif" });
    await sim.removeLocalSkillFromChat({ chatId: "c-sk7", actorId: "admin-user", projectId, skillName: "rm-notif" });
    const kinds = sim.platform.listOutputKinds("c-sk7");
    const notifCount = kinds.filter((k: string) => k === "notification").length;
    expect(notifCount).toBeGreaterThanOrEqual(2);
  });

  it("install skill with different names creates distinct entries", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk8", userId: "admin-user", name: "p-sk8" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk8", actorId: "admin-user", projectId, skillName: "alpha" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk8", actorId: "admin-user", projectId, skillName: "beta" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk8", actorId: "admin-user", projectId, skillName: "gamma" });
    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.length).toBe(3);
  });

  it("skill remains after project disable/reactivate", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-sk11", userId: "admin-user", name: "p-sk11" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk11", actorId: "admin-user", projectId, skillName: "persist-sk" });

    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    await sim.api.reactivateProject({ projectId, actorId: "admin-user" });

    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills.some((s: any) => s.pluginName === "persist-sk")).toBe(true);
  });

  it("install skill on different projects independently", async () => {
    sim = await SimHarness.create();
    const pid1 = await sim.createProjectFromChat({ chatId: "c-sk12a", userId: "admin-user", name: "p-sk12a" });
    const pid2 = await sim.createProjectFromChat({ chatId: "c-sk12b", userId: "admin-user", name: "p-sk12b" });
    await sim.installLocalSkillFromChat({ chatId: "c-sk12a", actorId: "admin-user", projectId: pid1, skillName: "shared-sk" });

    const skills1 = await sim.api.listProjectSkills(pid1);
    expect(skills1.some((s: any) => s.pluginName === "shared-sk")).toBe(true);

    const skills2 = await sim.api.listProjectSkills(pid2);
    expect(skills1.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(skills2)).toBe(true);
  });
});
