import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { userInputScript } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("user-input sim", () => {
  it("user input: request → reply → continuation", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-input", userId: "admin-user", name: "p-input" });

    await sim.startScriptedTurn({
      projectId, chatId: "c-input", userId: "admin-user",
      threadName: "t-input", threadId: "", turnId: "",
      script: userInputScript("call-inp-1"),
    });

    expect(sim.platform.listOutputKinds("c-input")).toContain("user_input_request");

    await sim.replyUserInput({
      chatId: "c-input", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-inp-1", answers: { q1: ["A"] } },
    });

    const outputs = sim.platform.listOutputs("c-input").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "content" && (o as any).data.delta.includes("input received"))).toBe(true);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });

  it("multi-question form", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-multi", userId: "admin-user", name: "p-multi" });

    const questions = [
      { id: "q1", text: "choose color", options: ["red", "blue"] },
      { id: "q2", text: "choose size", options: ["S", "M", "L"] },
    ];

    await sim.startScriptedTurn({
      projectId, chatId: "c-multi", userId: "admin-user",
      threadName: "t-multi-q", threadId: "", turnId: "",
      script: userInputScript("call-multi", questions),
    });

    expect(sim.platform.listOutputKinds("c-multi")).toContain("user_input_request");

    await sim.replyUserInput({
      chatId: "c-multi", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-multi", answers: { q1: ["blue"], q2: ["M"] } },
    });

    const outputs = sim.platform.listOutputs("c-multi").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });
});
