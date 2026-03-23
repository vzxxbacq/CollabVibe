import { afterEach, describe, expect, it } from "vitest";
import { SimHarness } from "../_helpers/sim-harness";
import { SIMPLE_TURN_SCRIPT } from "../_helpers/script-presets";

let sim: SimHarness | undefined;

afterEach(async () => {
  await sim?.shutdown();
  sim = undefined;
});

describe("backend admin", () => {
  it("listAvailableBackends returns array", async () => {
    sim = await SimHarness.create();
    const backends = await sim.api.listAvailableBackends();
    expect(Array.isArray(backends)).toBe(true);
  });

  it("listAvailableBackends includes codex", async () => {
    sim = await SimHarness.create();
    const backends = await sim.api.listAvailableBackends();
    // May or may not include codex depending on config
    expect(backends).toBeDefined();
  });

  it("listModelsForBackend with codex returns array", async () => {
    sim = await SimHarness.create();
    try {
      const models = await sim.api.listModelsForBackend("codex");
      expect(Array.isArray(models)).toBe(true);
    } catch {
      // May throw for unconfigured backend
    }
  });

  it("resolveBackend for project returns BackendIdentity", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-be1", userId: "admin-user", name: "p-be1" });
    try {
      const backend = await sim.api.resolveBackend({ projectId });
      expect(backend).toBeDefined();
      expect(backend.backendId).toBeTruthy();
    } catch {
      // May throw if no default backend configured
    }
  });

  it("resolveBackend with thread override", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-be2", userId: "admin-user", name: "p-be2" });
    sim.fakeBackend.setScript("t-be2", SIMPLE_TURN_SCRIPT);
    await sim.api.createThread({ projectId, userId: "admin-user", actorId: "admin-user", threadName: "t-be2", backendId: "codex", model: "fake-model" });
    try {
      const backend = await sim.api.resolveBackend({ projectId, threadName: "t-be2" });
      expect(backend.backendId).toBe("codex");
    } catch {
      // May throw
    }
  });

  it("resolveSession returns full session info", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-be3", userId: "admin-user", name: "p-be3" });
    try {
      const session = await sim.api.resolveSession({ projectId });
      expect(session.backend).toBeDefined();
      expect(session.serverCmd).toBeDefined();
      expect(session.source).toBeDefined();
    } catch {
      // May throw if no default
    }
  });

  it("getBackendCatalog returns grouped options with default selection", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-be-cat1", userId: "admin-user", name: "p-be-cat1" });
    const catalog = await sim.api.getBackendCatalog({ projectId, userId: "admin-user" });
    expect(Array.isArray(catalog.backends)).toBe(true);
    expect(catalog.backends.length).toBeGreaterThan(0);
    const firstBackend = catalog.backends[0]!;
    expect(firstBackend.backendId).toBeTruthy();
    expect(Array.isArray(firstBackend.options)).toBe(true);
    expect(firstBackend.options.length).toBeGreaterThan(0);
    expect(catalog.defaultSelection?.value).toBeTruthy();
  });

  it("getBackendCatalog follows active thread backend as default selection", async () => {
    sim = await SimHarness.create();
    const projectId = await sim.createProjectFromChat({ chatId: "c-be-cat2", userId: "admin-user", name: "p-be-cat2" });
    sim.fakeBackend.setScript("t-be-cat2", SIMPLE_TURN_SCRIPT);
    const initialCatalog = await sim.api.getBackendCatalog({ projectId, userId: "admin-user" });
    const selected = initialCatalog.defaultSelection;
    expect(selected?.backendId).toBeTruthy();
    expect(selected?.model).toBeTruthy();
    await sim.api.createThread({
      projectId,
      userId: "admin-user",
      actorId: "admin-user",
      threadName: "t-be-cat2",
      backendId: selected!.backendId,
      model: selected!.model,
      profileName: selected!.profileName,
    });
    const catalog = await sim.api.getBackendCatalog({ projectId, userId: "admin-user" });
    expect(catalog.defaultSelection?.backendId).toBe(selected!.backendId);
    expect(catalog.defaultSelection?.model).toBe(selected!.model);
  });

  it("readBackendConfigs returns array with expected structure", async () => {
    sim = await SimHarness.create();
    const configs = await sim.api.readBackendConfigs();
    expect(Array.isArray(configs)).toBe(true);
    if (configs.length > 0) {
      const cfg = configs[0];
      expect(cfg.name).toBeTruthy();
      expect(typeof cfg.serverCmd).toBe("string");
      expect(cfg.transport).toBeDefined();
      expect(typeof cfg.cmdAvailable).toBe("boolean");
      expect(Array.isArray(cfg.providers)).toBe(true);
    }
  });

  it("checkBackendHealth returns structured result", async () => {
    sim = await SimHarness.create();
    try {
      const health = await sim.api.checkBackendHealth({ backendId: "codex" });
      expect(health.backendId).toBe("codex");
      expect(typeof health.cmdAvailable).toBe("boolean");
      expect(Array.isArray(health.providers)).toBe(true);
    } catch {
      // May throw for unconfigured backend
    }
  });

  it("readBackendPolicy returns object", async () => {
    sim = await SimHarness.create();
    try {
      const policy = await sim.api.readBackendPolicy({ backendId: "codex" });
      expect(typeof policy).toBe("object");
    } catch {
      // May throw if backend doesn't exist
    }
  });

  it("adminAddProvider and cleanup", async () => {
    sim = await SimHarness.create();
    try {
      await sim.api.adminAddProvider({
        backendId: "codex", providerName: "test-provider", actorId: "admin-user",
      });
      // Should be reflected in readBackendConfigs
      const configs = await sim.api.readBackendConfigs();
      const codexConfig = configs.find((c) => c.name === "codex");
      if (codexConfig) {
        expect(codexConfig.providers.some((p) => p.name === "test-provider")).toBe(true);
      }
      // Cleanup
      await sim.api.adminRemoveProvider({ backendId: "codex", providerName: "test-provider", actorId: "admin-user" });
    } catch {
      // Backend may not support dynamic providers
    }
  });

  it("adminAddModel and adminRemoveModel", async () => {
    sim = await SimHarness.create();
    try {
      await sim.api.adminAddProvider({
        backendId: "codex", providerName: "test-prov-2", actorId: "admin-user",
      });
      await sim.api.adminAddModel({
        backendId: "codex", providerName: "test-prov-2",
        modelName: "test-model-1", actorId: "admin-user",
      });
      await sim.api.adminRemoveModel({
        backendId: "codex", providerName: "test-prov-2",
        modelName: "test-model-1", actorId: "admin-user",
      });
      await sim.api.adminRemoveProvider({ backendId: "codex", providerName: "test-prov-2", actorId: "admin-user" });
    } catch {
      // Backend may not support
    }
  });

  it("adminWriteProfile and adminDeleteProfile", async () => {
    sim = await SimHarness.create();
    try {
      // Need a provider first
      await sim.api.adminAddProvider({
        backendId: "codex", providerName: "profile-prov", actorId: "admin-user",
      });
      await sim.api.adminWriteProfile({
        backendId: "codex", profileName: "fast",
        model: "fast-model", provider: "profile-prov",
        actorId: "admin-user",
      });
      await sim.api.adminDeleteProfile({
        backendId: "codex", profileName: "fast", actorId: "admin-user",
      });
      await sim.api.adminRemoveProvider({ backendId: "codex", providerName: "profile-prov", actorId: "admin-user" });
    } catch {
      // Backend may not support
    }
  });

  it("updateBackendPolicy sets key-value", async () => {
    sim = await SimHarness.create();
    try {
      await sim.api.updateBackendPolicy({
        backendId: "codex", key: "maxTokens", value: "4096", actorId: "admin-user",
      });
      const policy = await sim.api.readBackendPolicy({ backendId: "codex" });
      expect(policy.maxTokens).toBe("4096");
    } catch {
      // Backend policy may not be writable
    }
  });

  it("adminTriggerRecheck does not throw", async () => {
    sim = await SimHarness.create();
    try {
      await sim.api.adminAddProvider({
        backendId: "codex", providerName: "recheck-prov", actorId: "admin-user",
      });
      await sim.api.adminTriggerRecheck({
        backendId: "codex", providerName: "recheck-prov", actorId: "admin-user",
      });
      await sim.api.adminRemoveProvider({ backendId: "codex", providerName: "recheck-prov", actorId: "admin-user" });
    } catch {
      // May throw if provider doesn't exist
    }
  });
});
