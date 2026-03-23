import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { approvalScript } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("approval sim", () => {
  it("approve: request → accept → continuation", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-appr", userId: "admin-user", name: "p-appr" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-appr", userId: "admin-user",
      threadName: "t-approve", threadId: "", turnId: "",
      script: approvalScript("appr-1"),
    });

    expect(sim.platform.listOutputKinds("c-appr")).toContain("approval_request");

    await sim.approve({
      chatId: "c-appr", userId: "admin-user", kind: "approval_decision",
      payload: { approvalId: "appr-1" },
    });

    const outputs = sim.platform.listOutputs("c-appr").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "content" && (o as any).data.delta.includes("continued"))).toBe(true);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });

  it("duplicate approval callback throws (approval already resolved)", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-dup", userId: "admin-user", name: "p-dup" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-dup", userId: "admin-user",
      threadName: "t-dup-appr", threadId: "", turnId: "",
      script: approvalScript("appr-dup"),
    });

    await sim.approve({
      chatId: "c-dup", userId: "admin-user", kind: "approval_decision",
      payload: { approvalId: "appr-dup" },
    });

    // Second approval — approval already resolved so it throws
    await expect(sim.api.handleApprovalCallback({
      approvalId: "appr-dup", decision: "accept",
    })).rejects.toThrow(/invalid approval id/);
  });
});
