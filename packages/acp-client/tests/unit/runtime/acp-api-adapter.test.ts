import { describe, expect, it, vi } from "vitest";

import { createBackendIdentity } from "../../../../../packages/agent-core/src/backend-identity";
import { AcpApiAdapter } from "../../../src/acp-api-adapter";

function createClient() {
  return {
    sessionNew: vi.fn(async () => ({ session: { id: "sess-1" } })),
    sessionLoad: vi.fn(async () => ({ session: { id: "sess-2" } })),
    prompt: vi.fn(async () => ({ turn: { id: "turn-1" } })),
    cancel: vi.fn(async () => undefined),
    respondApproval: vi.fn(async () => undefined),
    onSessionUpdate: vi.fn(),
    onPromptComplete: vi.fn(),
    onElicitationRequest: vi.fn(),
    close: vi.fn()
  };
}

describe("acp-api-adapter", () => {
  it("adapts session lifecycle to AgentApi", async () => {
    const client = createClient();
    const api = new AcpApiAdapter(client as never);

    await expect(api.threadStart({ backend: createBackendIdentity("opencode", "claude-sonnet") })).resolves.toEqual({
      thread: { id: "sess-1" }
    });
    await expect(api.threadResume("sess-old", { backend: createBackendIdentity("opencode", "claude-sonnet") })).resolves.toEqual({
      thread: { id: "sess-2" }
    });
    await expect(api.turnStart({
      threadId: "sess-2",
      traceId: "trace-1",
      input: [{ type: "text", text: "hello" }]
    })).resolves.toEqual({ turn: { id: "turn-1" } });

    await api.turnInterrupt("sess-2", "turn-1");
    expect(client.cancel).toHaveBeenCalledWith("sess-2", "turn-1");
  });

  it("maps approvals and emits unified events", async () => {
    const client = createClient();
    const api = new AcpApiAdapter(client as never);
    const handler = vi.fn();

    // Establish session first (sets currentSessionId)
    await api.threadStart({ backend: { backendId: "opencode", model: "m1", transport: "acp" }, cwd: "/tmp" } as never);

    api.onNotification?.(handler);
    const onSessionUpdate = client.onSessionUpdate.mock.calls[0]?.[0] as ((update: Record<string, unknown>) => void);
    onSessionUpdate({
      type: "agent_message_chunk",
      delta: "hello"
    });

    expect(handler).toHaveBeenCalledWith({
      type: "content_delta",
      delta: "hello"
    });

    await api.respondApproval?.({
      action: "approve_always",
      approvalId: "call-1",
    });
    expect(client.respondApproval).toHaveBeenCalledWith("sess-1", "call-1", "allow_always");

    api.close();
    expect(client.close).toHaveBeenCalled();
  });

  it("turnStart throws if session not established", async () => {
    const client = createClient();
    const api = new AcpApiAdapter(client as never);

    await expect(api.turnStart({
      threadId: "thread-1",
      input: [{ type: "text", text: "hello" }]
    })).rejects.toThrow("ACP session not established");
    expect(client.prompt).not.toHaveBeenCalled();
  });

  // ── ensureSession tests ──

  it("ensureSession: session/load succeeds → session established", async () => {
    const client = createClient();
    const api = new AcpApiAdapter(client as never);

    await api.ensureSession("sess-old", { backend: createBackendIdentity("opencode", "m1") });

    expect(client.sessionLoad).toHaveBeenCalledWith(
      "sess-old",
      expect.objectContaining({
        backend: expect.objectContaining({
          backendId: "opencode",
          model: "m1",
          transport: "acp"
        })
      })
    );
    expect(client.sessionNew).not.toHaveBeenCalled();

    // turnStart should now work
    await expect(api.turnStart({
      threadId: "sess-old",
      input: [{ type: "text", text: "hello" }]
    })).resolves.toEqual({ turn: { id: "turn-1" } });
  });

  it("ensureSession: session/load fails → throws without fallback to session/new", async () => {
    const client = createClient();
    client.sessionLoad.mockRejectedValueOnce(new Error("session expired"));
    const api = new AcpApiAdapter(client as never);

    await expect(api.ensureSession("sess-expired", { backend: createBackendIdentity("opencode", "m1") }))
      .rejects.toThrow("ACP session 已失效");

    // session/new must NOT be called — no silent fallback
    expect(client.sessionNew).not.toHaveBeenCalled();
  });
});
