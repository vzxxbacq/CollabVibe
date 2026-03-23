import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("plugin sim", () => {
  it("install and list local skill", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-skill", userId: "admin-user", name: "p-skill" });

    await sim.installLocalSkillFromChat({ chatId: "c-skill", actorId: "admin-user", projectId, skillName: "test-skill" });

    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ pluginName: "test-skill", enabled: true }),
    ]));
  });

  it("remove skill and verify removed", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-rm-skill", userId: "admin-user", name: "p-rm-skill" });

    await sim.installLocalSkillFromChat({ chatId: "c-rm-skill", actorId: "admin-user", projectId, skillName: "rm-skill" });
    await sim.removeLocalSkillFromChat({ chatId: "c-rm-skill", actorId: "admin-user", projectId, skillName: "rm-skill" });

    const skills = await sim.api.listProjectSkills(projectId);
    expect(skills).toEqual([]);
  });

  it("install two skills and list both", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-multi-skill", userId: "admin-user", name: "p-multi-skill" });

    await sim.installLocalSkillFromChat({ chatId: "c-multi-skill", actorId: "admin-user", projectId, skillName: "skill-a" });
    await sim.installLocalSkillFromChat({ chatId: "c-multi-skill", actorId: "admin-user", projectId, skillName: "skill-b" });

    const skills = await sim.api.listProjectSkills(projectId);
    const names = skills.map((s: any) => s.pluginName);
    expect(names).toContain("skill-a");
    expect(names).toContain("skill-b");
  });

  it("outputs notification on install and remove", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-skill-out", userId: "admin-user", name: "p-skill-out" });

    await sim.installLocalSkillFromChat({ chatId: "c-skill-out", actorId: "admin-user", projectId, skillName: "notif-skill" });
    await sim.removeLocalSkillFromChat({ chatId: "c-skill-out", actorId: "admin-user", projectId, skillName: "notif-skill" });

    const kinds = sim.platform.listOutputKinds("c-skill-out");
    expect(kinds).toContain("notification");
  });
});
