import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.exitCode = signal === "SIGTERM" ? 0 : 1;
    this.emit("exit", this.exitCode, signal ?? null);
    return true;
  });
}

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

describe("acp-process-manager", () => {
  afterEach(() => {
    spawnMock.mockReset();
  });

  it("reuses running process for the same session and preserves cwd", async () => {
    const first = new FakeProcess();
    spawnMock.mockReturnValue(first);
    const { AcpProcessManager } = await import("../../../src/acp-process-manager");
    const manager = new AcpProcessManager();

    const a = await manager.start("chat-1:u1", "claude --acp", "/repo/thread-a");
    const b = await manager.start("chat-1:u1", "claude --acp", "/repo/thread-a");

    expect(a).toBe(b);
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith("claude --acp", expect.objectContaining({
      shell: true,
      cwd: "/repo/thread-a",
      stdio: "pipe"
    }));
  });

  it("recreates the process after exit and stop kills active process", async () => {
    const first = new FakeProcess();
    const second = new FakeProcess();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const { AcpProcessManager } = await import("../../../src/acp-process-manager");
    const manager = new AcpProcessManager();

    const started = await manager.start("chat-1:u2", "opencode --acp", "/repo/thread-b");
    expect(started).toBe(first);

    first.exitCode = 1;
    first.emit("exit", 1, null);

    const restarted = await manager.start("chat-1:u2", "opencode --acp", "/repo/thread-b");
    expect(restarted).toBe(second);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    await manager.stop("chat-1:u2");
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");

    await manager.stop("chat-1:missing");
  });
});
