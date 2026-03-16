/**
 * Review issue regression tests for AgentProcessManager
 * Covers: #3 (process exit not cleaned up, stale process reuse)
 */
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

describe("process-manager-review: regression tests for issue #3", () => {
    it("[R3-1] start() returns new process after previous process exited", async () => {
        const process1 = new FakeProcess();
        const process2 = new FakeProcess();
        let callCount = 0;
        const spawner = () => {
            callCount += 1;
            return callCount === 1 ? process1 : process2;
        };
        const manager = new AgentProcessManager(spawner);

        const first = await manager.start("chat-1", { serverCmd: "codex app-server" });
        expect(first).toBe(process1);

        // Simulate process crash
        process1.exitCode = 1;
        process1.emit("exit", 1);

        const second = await manager.start("chat-1", { serverCmd: "codex app-server" });
        expect(second).toBe(process2);
        expect(second).not.toBe(process1);
        expect(second.exitCode).toBeNull();
    });

    it("[R3-2] healthCheck reports dead after exit and start() creates new", async () => {
        const process1 = new FakeProcess();
        const process2 = new FakeProcess();
        let callCount = 0;
        const spawner = () => {
            callCount += 1;
            return callCount === 1 ? process1 : process2;
        };
        const manager = new AgentProcessManager(spawner);

        await manager.start("chat-1", { serverCmd: "codex app-server" });

        // Crash the process
        process1.exitCode = 1;
        process1.emit("exit", 1);

        const health = await manager.healthCheck("chat-1");
        expect(health.alive).toBe(false);

        const restarted = await manager.start("chat-1", { serverCmd: "codex app-server" });
        expect(restarted).toBe(process2);
        expect(restarted.exitCode).toBeNull();
    });

    it("[R3-3] start() should detect exitCode !== null on existing process and rebuild", async () => {
        const process1 = new FakeProcess();
        const process2 = new FakeProcess();
        let callCount = 0;
        const spawner = () => {
            callCount += 1;
            return callCount === 1 ? process1 : process2;
        };
        const manager = new AgentProcessManager(spawner);

        await manager.start("chat-1", { serverCmd: "codex app-server" });

        // Set exitCode without triggering event (simulates race condition)
        process1.exitCode = 137;

        const result = await manager.start("chat-1", { serverCmd: "codex app-server" });
        expect(result).toBe(process2);
        expect(result.exitCode).toBeNull();
    });
});
