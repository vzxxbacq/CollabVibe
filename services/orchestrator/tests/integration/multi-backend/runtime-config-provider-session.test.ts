import { describe, expect, it } from "vitest";

import { DefaultRuntimeConfigProvider } from "../../../src/backend/runtime-config-provider";

describe("runtime-config-provider session scope", () => {
  it("derives config from project + defaults (no binding lookup)", async () => {
    const provider = new DefaultRuntimeConfigProvider(
      {
        findProjectByChatId: (chatId: string) => {
          if (chatId === "chat-1") {
            return {
              cwd: "/repo/project",
              sandbox: "workspace-write",
              approvalPolicy: "on-request"
            };
          }
          return null;
        }
      },
      {
        codex: {
          model: "gpt-5-codex",
          cwd: "/repo/default",
          sandbox: "workspace-write",
          approvalPolicy: "on-request",
          serverCmd: "codex",
        },
        server: { port: 3100 }
      }
    );

    // Chat with project → uses project cwd
    const configA = await provider.getProjectRuntimeConfig("chat-1", "u-a");
    expect(configA.cwd).toBe("/repo/project");

    // Chat without project → uses defaults
    const configB = await provider.getProjectRuntimeConfig("chat-other", "u-b");
    expect(configB.cwd).toBe("/repo/default");
  });
});
