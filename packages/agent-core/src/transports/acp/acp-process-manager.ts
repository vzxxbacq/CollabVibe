import { spawn } from "node:child_process";
import { createLogger } from "../../../../logger/src/index";
import type { ManagedProcess } from "../../agent-process-manager";

const log = createLogger("acp-process");

export class AcpProcessManager {
  private readonly processes = new Map<string, ManagedProcess>();

  async start(sessionKey: string, command: string, cwd?: string, env?: Record<string, string>): Promise<ManagedProcess> {
    const existing = this.processes.get(sessionKey);
    if (existing && existing.exitCode === null) {
      log.info({ sessionKey }, "reusing existing ACP process");
      return existing;
    }
    const mergedEnv = { ...process.env, ...env };
    log.info({ sessionKey, command, cwd, extraEnvKeys: env ? Object.keys(env) : [] }, "spawning ACP process");
    const child = spawn(command, { shell: true, cwd, stdio: "pipe", env: mergedEnv }) as unknown as ManagedProcess;
    this.processes.set(sessionKey, child);
    child.once("exit", (code) => {
      log.info({ sessionKey, exitCode: code }, "ACP process exited");
      if (this.processes.get(sessionKey) === child) {
        this.processes.delete(sessionKey);
      }
    });
    return child;
  }

  async stop(sessionKey: string): Promise<void> {
    const process = this.processes.get(sessionKey);
    if (!process) {
      return;
    }
    process.kill("SIGTERM");
    this.processes.delete(sessionKey);
  }
}
