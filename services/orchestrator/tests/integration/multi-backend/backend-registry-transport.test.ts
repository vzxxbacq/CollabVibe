import { describe, expect, it } from "vitest";

import { createBackendRegistry } from "../../../src/backend/registry";

describe("backend-registry transport", () => {
  it("upsert + register backends with transport metadata", () => {
    const registry = createBackendRegistry();

    registry.register({
      name: "codex",
      transport: "codex",
      serverCmd: "codex app-server",
      models: ["gpt-5-codex"]
    });

    registry.register({
      name: "claude-code",
      transport: "acp",
      serverCmd: "claude --acp",
      models: ["claude-sonnet-4"]
    });

    expect(registry.get("codex")).toMatchObject({ transport: "codex", serverCmd: "codex app-server" });
    expect(registry.get("claude-code")).toMatchObject({
      transport: "acp",
      serverCmd: "claude --acp",
      models: ["claude-sonnet-4"]
    });
  });

  it("setDefault changes the default backend", () => {
    const registry = createBackendRegistry();

    registry.register({ name: "codex", transport: "codex", serverCmd: "codex app-server" });
    registry.register({ name: "claude-code", transport: "acp", serverCmd: "claude --acp" });

    expect(registry.getDefaultName()).toBe("codex"); // first registered is default

    registry.setDefault("claude-code");
    expect(registry.getDefaultName()).toBe("claude-code");
    expect(registry.getDefault()?.transport).toBe("acp");
  });

  it("upsert replaces existing backend definition", () => {
    const registry = createBackendRegistry();

    registry.register({ name: "codex", transport: "codex", serverCmd: "codex", models: ["old-model"] });
    registry.upsert({ name: "codex", transport: "codex", serverCmd: "codex app-server", models: ["new-model"] });

    expect(registry.get("codex")).toMatchObject({
      serverCmd: "codex app-server",
      models: ["new-model"]
    });
  });
});
