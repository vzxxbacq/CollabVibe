import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable, Writable } from "node:stream";
import { createLogger } from "../../channel-core/src/index";

const log = createLogger("process");

export interface ManagedProcess extends EventEmitter {
  kill(signal?: NodeJS.Signals): boolean;
  exitCode: number | null;
  stdin?: Writable | null;
  stdout?: Readable | null;
}

export interface ProcessSpawnConfig {
  serverCmd?: string;
  serverPort?: number;
  cwd?: string;
  /** Extra env vars for the spawned process (e.g. OPENCODE_CONFIG) */
  env?: Record<string, string>;
}

type SpawnProcess = (command: string, runtimeConfig: ProcessSpawnConfig) => ManagedProcess;

interface ProcessEntry {
  process: ManagedProcess;
  activeTurns: number;
  closing?: Promise<void>;
}

function defaultSpawner(command: string, runtimeConfig: ProcessSpawnConfig): ManagedProcess {
  const env = { ...process.env, ...runtimeConfig.env };
  return spawn(command, {
    shell: true,
    cwd: runtimeConfig.cwd,
    stdio: "pipe",
    env
  }) as unknown as ManagedProcess;
}

export class AgentProcessManager {
  private readonly spawnProcess: SpawnProcess;

  private readonly processes = new Map<string, ProcessEntry>();

  constructor(spawnProcess: SpawnProcess = defaultSpawner) {
    this.spawnProcess = spawnProcess;
  }

  async start(chatId: string, runtimeConfig: ProcessSpawnConfig): Promise<ManagedProcess> {
    if (!runtimeConfig.serverCmd) {
      throw new Error("server command missing");
    }
    const existing = this.processes.get(chatId);
    if (existing) {
      if (existing.process.exitCode !== null) {
        this.processes.delete(chatId);
      } else {
        return existing.process;
      }
    }
    log.info({ chatId, cwd: runtimeConfig.cwd, cmd: runtimeConfig.serverCmd, envKeys: runtimeConfig.env ? Object.keys(runtimeConfig.env) : [] }, "starting process");
    const process = this.spawnProcess(runtimeConfig.serverCmd, runtimeConfig);
    this.processes.set(chatId, { process, activeTurns: 0 });

    const cleanup = () => {
      const current = this.processes.get(chatId);
      if (!current || current.process !== process) {
        return;
      }
      this.processes.delete(chatId);
    };

    process.once("exit", cleanup);
    process.once("close", cleanup);

    return process;
  }

  markTurn(chatId: string, delta: 1 | -1): void {
    const entry = this.processes.get(chatId);
    if (!entry) {
      return;
    }
    entry.activeTurns = Math.max(0, entry.activeTurns + delta);
  }

  async stop(chatId: string): Promise<void> {
    const entry = this.processes.get(chatId);
    if (!entry) {
      return;
    }
    if (entry.closing) {
      await entry.closing;
      return;
    }

    entry.closing = (async () => {
      const startedAt = Date.now();
      while (entry.activeTurns > 0 && Date.now() - startedAt < 5_000) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      entry.process.kill("SIGTERM");
      this.processes.delete(chatId);
    })();

    await entry.closing;
  }

  async healthCheck(chatId: string): Promise<{ alive: boolean; threadCount: number }> {
    const entry = this.processes.get(chatId);
    if (!entry) {
      return { alive: false, threadCount: 0 };
    }
    return {
      alive: entry.process.exitCode === null,
      threadCount: entry.activeTurns
    };
  }
}
