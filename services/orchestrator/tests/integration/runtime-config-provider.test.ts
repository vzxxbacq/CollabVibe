import { describe, expect, it } from "vitest";

import { DefaultRuntimeConfigProvider } from "../../src/backend/runtime-config-provider";
import { createBackendIdentity } from "../../../../../packages/agent-core/src/backend-identity";

const appConfig = {
  feishu: {
    appId: "app",
    appSecret: "secret",
    signingSecret: "signing",
    apiBaseUrl: "https://open.feishu.cn/open-apis"
  },
  codex: {
    serverCmd: "codex app-server",
    cwd: "/repo/default",
    model: "gpt-5-codex",
    sandbox: "workspace-write",
    approvalPolicy: "on-request"
  },
  server: {
    port: 3000,
    approvalTimeoutMs: 300000,
    sysAdminUserIds: []
  }
};

const expectedBackend = createBackendIdentity("codex", "gpt-5-codex");

describe("runtime-config-provider", () => {
  it("uses project config when chat binding exists", async () => {
    const provider = new DefaultRuntimeConfigProvider(
      {
        findProjectByChatId: () => ({
          id: "proj-1",
          name: "proj",
          chatId: "chat-1",
          cwd: "/repo/project",
          sandbox: "read-only",
          approvalPolicy: "never",
          status: "active"
        })
      } as never,
      appConfig
    );

    await expect(provider.getProjectRuntimeConfig("chat-1")).resolves.toEqual({
      backend: expectedBackend,
      cwd: "/repo/project",
      sandbox: "read-only",
      approvalPolicy: "never",
      serverCmd: "codex app-server",
      serverPort: 3000
    });
  });

  it("falls back to global defaults when project is missing", async () => {
    const provider = new DefaultRuntimeConfigProvider(
      {
        findProjectByChatId: () => null
      } as never,
      appConfig
    );

    await expect(provider.getProjectRuntimeConfig("chat-missing")).resolves.toEqual({
      backend: expectedBackend,
      cwd: "/repo/default",
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      serverCmd: "codex app-server",
      serverPort: 3000
    });
  });

  it("[C5-3] falls back to global defaults when admin api is null", async () => {
    const provider = new DefaultRuntimeConfigProvider(null, appConfig);

    await expect(provider.getProjectRuntimeConfig("chat-2")).resolves.toEqual({
      backend: expectedBackend,
      cwd: "/repo/default",
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      serverCmd: "codex app-server",
      serverPort: 3000
    });
  });

  it("[C5-4] always keeps backend from global defaults even when project has model-like field", async () => {
    const provider = new DefaultRuntimeConfigProvider(
      {
        findProjectByChatId: () =>
          ({
            id: "proj-1",
            name: "proj",
            chatId: "chat-1",
            cwd: "/repo/project",
            sandbox: "read-only",
            approvalPolicy: "never",
            status: "active",
            model: "gpt-x"
          }) as unknown
      } as never,
      appConfig
    );

    const runtime = await provider.getProjectRuntimeConfig("chat-1");
    expect(runtime.backend.model).toBe("gpt-5-codex");
  });
});
