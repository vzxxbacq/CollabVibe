import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("project lifecycle", () => {
  it("create project, disable, and reactivate", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-life", userId: "admin-user", name: "p-life" });

    await sim.api.disableProject({ projectId, actorId: "admin-user" });
    const record1 = await sim.api.getProjectRecord(projectId);
    expect(record1?.status).toBe("disabled");

    await sim.api.reactivateProject({ projectId, actorId: "admin-user" });
    const record2 = await sim.api.getProjectRecord(projectId);
    expect(record2?.status).toBe("active");
  });

  it("delete project removes it from list", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-del", userId: "admin-user", name: "p-del" });

    await sim.api.deleteProject({ projectId, actorId: "admin-user" });
    const record = await sim.api.getProjectRecord(projectId);
    expect(record).toBeNull();
  });

  it("resolveProjectId returns null after unlink", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-unlink", userId: "admin-user", name: "p-unlink" });

    expect(await sim.api.resolveProjectId("c-unlink")).toBe(projectId);

    await sim.api.unlinkProject({ projectId, actorId: "admin-user" });
    expect(await sim.api.resolveProjectId("c-unlink")).toBeNull();
  });

  it("rebind project to different chat", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-old", userId: "admin-user", name: "p-rebind" });

    await sim.api.unlinkProject({ projectId, actorId: "admin-user" });
    await sim.api.linkProjectToChat({ projectId, chatId: "c-new", ownerId: "admin-user", actorId: "admin-user" });

    expect(await sim.api.resolveProjectId("c-old")).toBeNull();
    expect(await sim.api.resolveProjectId("c-new")).toBe(projectId);
  });
});
