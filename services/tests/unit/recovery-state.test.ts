import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("recovery state", () => {
  it("project survives shutdown and re-read", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-recov", userId: "admin-user", name: "p-recov" });

    const record = sim.api.getProjectRecord(projectId);
    expect(record).toBeDefined();
    expect(record?.name).toBe("p-recov");
    expect(record?.status).toBe("active");
  });

  it("admin list persists across operations", async () => {
    sim = await SimHarness.create(["root-admin"]);
    sim.api.addAdmin("second-admin");

    const admins = sim.api.listAdmins();
    const ids = admins.map((a: any) => a.userId);
    expect(ids).toContain("root-admin");
    expect(ids).toContain("second-admin");
  });
});
