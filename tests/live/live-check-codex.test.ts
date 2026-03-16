import { describe, expect, it } from "vitest";

// @ts-ignore - live-env.mjs does not have type definitions
import { assertLiveEnv, classifyLiveError, getLiveCodexCommand } from "../../scripts/live-env.mjs";

describe("live-check-codex env helpers", () => {
  it("returns trimmed CODEX_APP_SERVER_CMD", () => {
    expect(getLiveCodexCommand({ CODEX_APP_SERVER_CMD: "  codex app-server  " })).toBe("codex app-server");
  });

  it("throws ENV_MISSING when command is absent", () => {
    expect(() => assertLiveEnv({})).toThrowError("CODEX_APP_SERVER_CMD is required for live codex tests");
  });

  it("classifies process boot failures", () => {
    expect(classifyLiveError(new Error("write EPIPE"))).toBe("PROCESS_START_FAILED");
    expect(classifyLiveError(new Error("start failed: command not found"))).toBe("PROCESS_START_FAILED");
  });

  it("classifies transient timeout/network failures", () => {
    expect(classifyLiveError(new Error("request timeout for initialize"))).toBe("TRANSIENT_NETWORK");
    expect(classifyLiveError(new Error("socket closed before response"))).toBe("TRANSIENT_NETWORK");
  });
});
