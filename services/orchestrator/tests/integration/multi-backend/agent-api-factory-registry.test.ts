import { describe, expect, it, vi } from "vitest";

import { AgentApiFactoryRegistry } from "../../../src/session/factory-registry";
import { DefaultAgentApiPool } from "../../../src/session/agent-api-pool";
import { createBackendIdentity } from "../../../../../packages/agent-core/src/backend-identity";

describe("agent-api-factory-registry", () => {
  it("routes create/dispose/healthCheck by transport/backend type", async () => {
    const codexApi = { backendType: "codex" as const, threadStart: vi.fn(), turnStart: vi.fn() };
    const acpApi = { backendType: "acp" as const, threadStart: vi.fn(), turnStart: vi.fn() };
    const codexFactory = {
      create: vi.fn(async () => codexApi),
      dispose: vi.fn(async () => undefined),
      healthCheck: vi.fn(async () => ({ alive: true, threadCount: 1 }))
    };
    const acpFactory = {
      create: vi.fn(async () => acpApi),
      dispose: vi.fn(async () => undefined),
      healthCheck: vi.fn(async () => ({ alive: true, threadCount: 2 }))
    };
    const registry = new AgentApiFactoryRegistry({ codex: codexFactory as never, acp: acpFactory as never });

    expect(await registry.create({ backend: createBackendIdentity("codex", "gpt-5"), chatId: "chat-1", threadName: "__main__" })).toBe(codexApi);
    expect(await registry.create({ backend: createBackendIdentity("opencode", "MiniMax"), chatId: "chat-2", threadName: "__main__" })).toBe(acpApi);
    expect(codexFactory.create).toHaveBeenCalledOnce();
    expect(acpFactory.create).toHaveBeenCalledOnce();

    await registry.dispose(acpApi as never);
    expect(acpFactory.dispose).toHaveBeenCalledWith(acpApi);
    expect(await registry.healthCheck(codexApi as never)).toEqual({ alive: true, threadCount: 1 });
  });

  it("lets the pool create ACP sessions when runtime config selects acp transport", async () => {
    const codexFactory = { create: vi.fn(async () => ({ backendType: "codex" as const, threadStart: vi.fn(), turnStart: vi.fn() })) };
    const acpFactory = { create: vi.fn(async () => ({ backendType: "acp" as const, threadStart: vi.fn(), turnStart: vi.fn() })) };
    const pool = new DefaultAgentApiPool({
      apiFactory: new AgentApiFactoryRegistry({ codex: codexFactory as never, acp: acpFactory as never })
    });

    const api = await pool.createWithConfig("chat-9", "thread-a", {
      backend: createBackendIdentity("claude-code", "claude-sonnet"),
      serverCmd: "claude --acp"
    } as never);

    expect(api.backendType).toBe("acp");
    expect(acpFactory.create).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat-9",
      threadName: "thread-a",
      serverCmd: "claude --acp"
    }));
    expect(codexFactory.create).not.toHaveBeenCalled();
  });
});
