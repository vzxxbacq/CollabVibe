import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { AgentProcessManager } from "../../../../../packages/agent-core/src/agent-process-manager";

class FakeProcess extends EventEmitter {
  exitCode: number | null = null;

  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.exitCode = signal === "SIGTERM" ? 0 : 1;
    this.emit("exit", this.exitCode);
    return true;
  });
}

describe("process-manager", () => {
  it("fails when server command is missing", async () => {
    const manager = new AgentProcessManager();
    await expect(manager.start("chat-1", {})).rejects.toThrowError("server command missing");
  });

  it("reports unhealthy process after crash", async () => {
    const process = new FakeProcess();
    const manager = new AgentProcessManager(() => process);

    await manager.start("chat-1", { serverCmd: "codex app-server" });
    expect(await manager.healthCheck("chat-1")).toEqual({ alive: true, threadCount: 0 });

    process.exitCode = 1;
    process.emit("exit", 1);
    expect(await manager.healthCheck("chat-1")).toEqual({ alive: false, threadCount: 0 });
  });

  it("waits active turns before graceful stop", async () => {
    const process = new FakeProcess();
    const manager = new AgentProcessManager(() => process);
    await manager.start("chat-1", { serverCmd: "codex app-server" });

    manager.markTurn("chat-1", 1);
    const stopping = manager.stop("chat-1");
    await Promise.resolve();
    expect(process.kill).not.toHaveBeenCalled();

    manager.markTurn("chat-1", -1);
    await stopping;
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
