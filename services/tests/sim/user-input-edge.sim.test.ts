import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { userInputScript } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("user input edge cases", () => {
  it("single question with 2 options", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui1", userId: "admin-user", name: "p-ui1" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui1", userId: "admin-user",
      threadName: "t-ui1", threadId: "", turnId: "",
      script: userInputScript("call-ui1"),
    });
    expect(sim.platform.listOutputKinds("c-ui1")).toContain("user_input_request");
    
    await sim.replyUserInput({
      chatId: "c-ui1", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui1", answers: { q1: ["A"] } },
    });
    
    const outputs = sim.platform.listOutputs("c-ui1").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });

  it("question with many options (>5)", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui2", userId: "admin-user", name: "p-ui2" });
    const questions = [{ id: "q1", text: "pick", options: ["A", "B", "C", "D", "E", "F", "G"] }];
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui2", userId: "admin-user",
      threadName: "t-ui2", threadId: "", turnId: "",
      script: userInputScript("call-ui2", questions),
    });
    expect(sim.platform.listOutputKinds("c-ui2")).toContain("user_input_request");
    
    await sim.replyUserInput({
      chatId: "c-ui2", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui2", answers: { q1: ["C"] } },
    });
    
    const outputs = sim.platform.listOutputs("c-ui2").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });

  it("multi-question form with correct answers", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui3", userId: "admin-user", name: "p-ui3" });
    const questions = [
      { id: "color", text: "pick color", options: ["red", "blue", "green"] },
      { id: "size", text: "pick size", options: ["S", "M", "L", "XL"] },
      { id: "shape", text: "pick shape", options: ["circle", "square"] },
    ];
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui3", userId: "admin-user",
      threadName: "t-ui3", threadId: "", turnId: "",
      script: userInputScript("call-ui3", questions),
    });
    
    await sim.replyUserInput({
      chatId: "c-ui3", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui3", answers: { color: ["blue"], size: ["M"], shape: ["circle"] } },
    });
    
    const outputs = sim.platform.listOutputs("c-ui3").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "content" && (o as any).data.delta.includes("input received"))).toBe(true);
  });

  it("user input request output shape validation", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui4", userId: "admin-user", name: "p-ui4" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui4", userId: "admin-user",
      threadName: "t-ui4", threadId: "", turnId: "",
      script: userInputScript("call-ui4"),
    });
    
    const outputs = sim.platform.listOutputs("c-ui4").map((o) => o.output);
    const userInputReq = outputs.find((o) => o.kind === "user_input_request");
    expect(userInputReq).toBeDefined();
    expect((userInputReq as any).data.callId).toBe("call-ui4");
    expect((userInputReq as any).data.questions).toBeDefined();
    expect(Array.isArray((userInputReq as any).data.questions)).toBe(true);
    
    // Clean up
    await sim.replyUserInput({
      chatId: "c-ui4", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui4", answers: { q1: ["A"] } },
    });
  });

  it("user input callId recorded in harness", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui5", userId: "admin-user", name: "p-ui5" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui5", userId: "admin-user",
      threadName: "t-ui5", threadId: "", turnId: "",
      script: userInputScript("call-ui5"),
    });
    
    expect(sim.userInputs.length).toBeGreaterThanOrEqual(1);
    expect(sim.userInputs.some((ui) => ui.callId === "call-ui5")).toBe(true);
    
    // Clean up
    await sim.replyUserInput({
      chatId: "c-ui5", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui5", answers: { q1: ["B"] } },
    });
  });

  it("replyUserInput with wrong callId throws", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui6", userId: "admin-user", name: "p-ui6" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui6", userId: "admin-user",
      threadName: "t-ui6", threadId: "", turnId: "",
      script: userInputScript("call-ui6"),
    });
    
    await expect(sim.replyUserInput({
      chatId: "c-ui6", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "wrong-call-id", answers: { q1: ["A"] } },
    })).rejects.toThrow();
    
    // Clean up
    await sim.replyUserInput({
      chatId: "c-ui6", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui6", answers: { q1: ["A"] } },
    });
  });

  it("user input flow produces continuation content", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui7", userId: "admin-user", name: "p-ui7" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui7", userId: "admin-user",
      threadName: "t-ui7", threadId: "", turnId: "",
      script: userInputScript("call-ui7"),
    });
    
    await sim.replyUserInput({
      chatId: "c-ui7", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui7", answers: { q1: ["A"] } },
    });
    
    // Should have content after input received
    const outputs = sim.platform.listOutputs("c-ui7").map((o) => o.output);
    const contentOutputs = outputs.filter((o) => o.kind === "content");
    expect(contentOutputs.length).toBeGreaterThan(0);
  });

  it("user input with single-character answer", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui8", userId: "admin-user", name: "p-ui8" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui8", userId: "admin-user",
      threadName: "t-ui8", threadId: "", turnId: "",
      script: userInputScript("call-ui8"),
    });
    
    await sim.replyUserInput({
      chatId: "c-ui8", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui8", answers: { q1: ["X"] } },
    });
    
    const outputs = sim.platform.listOutputs("c-ui8").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });

  it("user input with multiple selected answers", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui9", userId: "admin-user", name: "p-ui9" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui9", userId: "admin-user",
      threadName: "t-ui9", threadId: "", turnId: "",
      script: userInputScript("call-ui9"),
    });
    
    await sim.replyUserInput({
      chatId: "c-ui9", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui9", answers: { q1: ["A", "B"] } },
    });
    
    const outputs = sim.platform.listOutputs("c-ui9").map((o) => o.output);
    expect(outputs.some((o) => o.kind === "turn_summary")).toBe(true);
  });

  it("notification emitted on start of user input turn", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-ui10", userId: "admin-user", name: "p-ui10" });
    await sim.startScriptedTurn({
      projectId, chatId: "c-ui10", userId: "admin-user",
      threadName: "t-ui10", threadId: "", turnId: "",
      script: userInputScript("call-ui10"),
    });
    
    const kinds = sim.platform.listOutputKinds("c-ui10");
    expect(kinds).toContain("notification");
    
    // Clean up
    await sim.replyUserInput({
      chatId: "c-ui10", userId: "admin-user", kind: "user_input_reply",
      payload: { callId: "call-ui10", answers: { q1: ["A"] } },
    });
  });
});
