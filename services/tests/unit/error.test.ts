import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT, approvalScript } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("error and idempotency", () => {
  it("duplicate project create returns error", async () => {
    sim = await SimHarness.create();
    await sim.createProjectFromChat({ chatId: "c-err", userId: "admin-user", name: "p-err" });

    // Second create with same chatId should fail
    await expect(sim.createProjectFromChat({ chatId: "c-err", userId: "admin-user", name: "p-err2" }))
      .rejects.toThrow();
  });

  it("createThread with duplicate name throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dup-thr", userId: "admin-user", name: "p-dup-thr" });

    sim.fakeBackend.setScript("dup-thread", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "dup-thread", backendId: "codex", model: "fake",
    });

    // Same name again should throw
    sim.fakeBackend.setScript("dup-thread", SIMPLE_TURN_SCRIPT);
    await expect(sim.api.createThread({
      projectId, userId: "admin-user", actorId: "admin-user",
      threadName: "dup-thread", backendId: "codex", model: "fake",
    })).rejects.toThrow(/已存在|ALREADY_EXISTS/);
  });

  it("approval for non-existent approvalId throws", async () => {
    sim = await SimHarness.create();
    await sim.createProjectFromChat({ chatId: "c-bad-appr", userId: "admin-user", name: "p-bad-appr" });

    await expect(sim.api.handleApprovalCallback({
      approvalId: "non-existent", decision: "accept",
    })).rejects.toThrow();
  });

  it("resolveProjectId for unknown chatId returns null", async () => {
    sim = await SimHarness.create();
    expect(sim.api.resolveProjectId("unknown-chat")).toBeNull();
  });

  it("getProjectRecord for unknown projectId returns null", async () => {
    sim = await SimHarness.create();
    expect(sim.api.getProjectRecord("unknown-project")).toBeNull();
  });
});
