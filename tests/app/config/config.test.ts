import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "../../../src/config";

const BASE_ENV: NodeJS.ProcessEnv = {
  FEISHU_APP_ID: "cli_xxx",
  FEISHU_APP_SECRET: "secret"
};

describe("loadConfig", () => {
  it("throws when required fields are missing", () => {
    expect(() => loadConfig({}, { envFilePath: "/tmp/does-not-exist.env" })).toThrowError(ConfigError);
    expect(() => loadConfig({ ...BASE_ENV, FEISHU_APP_ID: "" }, { envFilePath: "/tmp/does-not-exist.env" })).toThrow(
      /FEISHU_APP_ID/
    );
  });

  it("fills defaults for optional values", () => {
    const config = loadConfig({ ...BASE_ENV }, { envFilePath: "/tmp/does-not-exist.env" });

    expect(config.server.port).toBe(3000);
    expect(config.server.approvalTimeoutMs).toBe(300_000);
    expect(config.sandbox).toBe("workspace-write");
    expect(config.approvalPolicy).toBe("on-request");
    expect(config.feishu.apiBaseUrl).toBe("https://open.feishu.cn/open-apis");
  });

  it("accepts full config values", () => {
    const config = loadConfig(
      {
        ...BASE_ENV,
        FEISHU_SIGNING_SECRET: "signing",
        FEISHU_ENCRYPT_KEY: "encrypt",
        FEISHU_API_BASE_URL: "https://example.feishu.test/open-apis",
        CODEX_WORKSPACE_CWD: "/repo/app",
        CODEX_SANDBOX: "read-only",
        CODEX_APPROVAL_POLICY: "never",
        PORT: "3456",
        APPROVAL_TIMEOUT_MS: "120000"
      },
      { envFilePath: "/tmp/does-not-exist.env" }
    );

    expect(config).toMatchObject({
      feishu: {
        appId: "cli_xxx",
        appSecret: "secret",
        signingSecret: "signing",
        encryptKey: "encrypt",
        apiBaseUrl: "https://example.feishu.test/open-apis"
      },
      cwd: "/repo/app",
      sandbox: "read-only",
      approvalPolicy: "never",
      server: {
        port: 3456,
        approvalTimeoutMs: 120000
      }
    });
  });

  it("[C0-7] falls back to port 3000 when PORT is not numeric", () => {
    const config = loadConfig({ ...BASE_ENV, PORT: "abc" }, { envFilePath: "/tmp/does-not-exist.env" });
    expect(config.server.port).toBe(3000);
  });

  it("[C0-8] falls back to port 3000 when PORT is empty", () => {
    const config = loadConfig({ ...BASE_ENV, PORT: "" }, { envFilePath: "/tmp/does-not-exist.env" });
    expect(config.server.port).toBe(3000);
  });

  it("[C0-9] keeps feishu encrypt key undefined when FEISHU_ENCRYPT_KEY is not set", () => {
    const config = loadConfig({ ...BASE_ENV }, { envFilePath: "/tmp/does-not-exist.env" });
    expect(config.feishu.encryptKey).toBeUndefined();
  });

  it("[C0-10] does not throw when FEISHU_SIGNING_SECRET is missing (Stream mode)", () => {
    const config = loadConfig({ ...BASE_ENV }, { envFilePath: "/tmp/does-not-exist.env" });
    expect(config.feishu.signingSecret).toBeUndefined();
  });

  it("[C0-11] accepts FEISHU_SIGNING_SECRET when provided (backward compat)", () => {
    const config = loadConfig({ ...BASE_ENV, FEISHU_SIGNING_SECRET: "sig_compat" }, { envFilePath: "/tmp/does-not-exist.env" });
    expect(config.feishu.signingSecret).toBe("sig_compat");
  });
});
