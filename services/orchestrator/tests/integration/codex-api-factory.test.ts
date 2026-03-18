import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { createBackendIdentity } from "../../../../../packages/agent-core/src/backend-identity";
import { CodexProtocolApiFactory } from "../../../../../packages/codex-client/src/codex-api-factory";

class FakeStdout extends EventEmitter {
  setEncoding(): void {
    return;
  }
}

class FakeStdin {
  readonly written: string[] = [];
  nextError: Error | null = null;

  constructor(private readonly onWrite: (chunk: string) => void) {}

  write(chunk: string, callback?: (error?: Error | null) => void): boolean {
    this.written.push(chunk);
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      callback?.(error);
      return false;
    }
    this.onWrite(chunk);
    callback?.(null);
    return true;
  }
}

class FakeProcess extends EventEmitter {
  readonly stdout = new FakeStdout();

  readonly stdin: FakeStdin;

  exitCode: number | null = null;

  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.exitCode = signal === "SIGTERM" ? 0 : 1;
    this.emit("close", this.exitCode, signal ?? null);
    return true;
  });

  constructor(
    private readonly options?: {
      initializeRpcError?: boolean;
      suppressInitializeResponse?: boolean;
    }
  ) {
    super();
    this.stdin = new FakeStdin((raw) => {
      const line = raw.trim();
      if (!line) {
        return;
      }
      const message = JSON.parse(line) as { id?: string; method: string };
      if (!message.id) {
        return;
      }
      if (message.method === "initialize") {
        if (this.options?.suppressInitializeResponse) {
          return;
        }
        if (this.options?.initializeRpcError) {
          this.stdout.emit(
            "data",
            `${JSON.stringify({ id: message.id, error: { code: -32000, message: "initialize failed" } })}\n`
          );
          return;
        }
        this.stdout.emit("data", `${JSON.stringify({ id: message.id, result: { capabilities: {} } })}\n`);
      } else if (message.method === "thread/start") {
        this.stdout.emit("data", `${JSON.stringify({ id: message.id, result: { thread: { id: "thr-1" } } })}\n`);
      } else if (message.method === "turn/start") {
        this.stdout.emit("data", `${JSON.stringify({ id: message.id, result: { turn: { id: "turn-1", status: "inProgress", items: [], error: null } } })}\n`);
      } else if (message.method === "execCommandApproval/respond" || message.method === "applyPatchApproval/respond") {
        this.stdout.emit("data", `${JSON.stringify({ id: message.id, result: { ok: true } })}\n`);
      }
    });
  }
}

describe("codex-api-factory", () => {
  it("creates codex api via process manager and initializes rpc client", async () => {
    const process = new FakeProcess();
    const processManager = {
      start: vi.fn(async () => process),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never, {
      name: "test-client",
      title: "Test Client",
      version: "1.0.0"
    });

    const api = await factory.create({
      chatId: "chat-1",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      serverCmd: "codex app-server",
      cwd: "/repo"
    } as never);

    expect(processManager.start).toHaveBeenCalledWith("chat-1:__main__", {
      serverCmd: "codex app-server",
      serverPort: undefined,
      cwd: "/repo"
    });

    await expect(api.threadStart({
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      cwd: "/repo",
      sandbox: "workspace-write",
      approvalPolicy: "on-request"
    } as never)).resolves.toEqual({
      thread: { id: "thr-1" }
    });
    await expect(
      api.turnStart({
        threadId: "thr-1",
        input: [{ type: "text", text: "hello" }]
      })
    ).resolves.toMatchObject({
      turn: { id: "turn-1" }
    });
  });

  it("forwards notifications and supports dispose/health check", async () => {
    const process = new FakeProcess();
    const processManager = {
      start: vi.fn(async () => process),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never);
    const api = await factory.create({
      chatId: "chat-2",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      serverCmd: "codex app-server"
    } as never);

    const onNotification = vi.fn();
    (api as { onNotification: (cb: (message: unknown) => void) => void }).onNotification(onNotification);
    process.stdout.emit("data", `${JSON.stringify({ method: "event/msg", params: { type: "task_complete" } })}\n`);
    expect(onNotification).toHaveBeenCalledWith({
      method: "event/msg",
      params: { type: "task_complete" }
    });

    expect(await factory.healthCheck(api)).toEqual({ alive: true, threadCount: 0 });
    process.exitCode = 1;
    expect(await factory.healthCheck(api)).toEqual({ alive: false, threadCount: 0 });

    await factory.dispose(api);
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(processManager.stop).toHaveBeenCalledWith("chat-2:__main__");
  });

  it("[C2-2] sends initialize rpc through stdio transport after process start", async () => {
    const process = new FakeProcess();
    const processManager = {
      start: vi.fn(async () => process),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never);

    await factory.create({
      chatId: "chat-init",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      serverCmd: "codex app-server"
    } as never);

    const joined = process.stdin.written.join("\n");
    expect(joined).toContain("\"method\":\"initialize\"");
  });

  it("[C2-5] proxies unified respondApproval for command approvals", async () => {
    const process = new FakeProcess();
    const processManager = {
      start: vi.fn(async () => process),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never);
    const api = await factory.create({
      chatId: "chat-approval",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      serverCmd: "codex app-server"
    } as never);

    await expect(
      api.respondApproval?.({
        action: "approve_always",
        approvalId: "appr-1",
        threadId: "thr-1",
        turnId: "turn-1",
        callId: "call-1",
        approvalType: "command_exec"
      })
    ).resolves.toBeUndefined();
    expect(process.stdin.written.join("\n")).toContain("\"decision\":\"acceptForSession\"");
  });

  it("[C2-6] proxies unified respondApproval for patch approvals", async () => {
    const process = new FakeProcess();
    const processManager = {
      start: vi.fn(async () => process),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never);
    const api = await factory.create({
      chatId: "chat-patch",
      backend: createBackendIdentity("codex", "gpt-5-codex"),
      serverCmd: "codex app-server"
    } as never);

    await expect(
      api.respondApproval?.({
        action: "deny",
        approvalId: "appr-2",
        threadId: "thr-1",
        turnId: "turn-1",
        callId: "call-2",
        approvalType: "file_change"
      })
    ).resolves.toBeUndefined();
    expect(process.stdin.written.join("\n")).toContain("\"decision\":\"decline\"");
  });

  it("[C2-7] throws when started process does not expose both stdin and stdout", async () => {
    const processManager = {
      start: vi.fn(async () => ({ stdin: null, stdout: null })),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never);

    await expect(
      factory.create({
        chatId: "chat-bad-stdio",
        backend: createBackendIdentity("codex", "gpt-5-codex"),
        serverCmd: "codex app-server"
      })
    ).rejects.toThrow(/stdin\/stdout/i);
  });

  it("[C2-8] rejects create when initialize rpc fails", async () => {
    const process = new FakeProcess({ initializeRpcError: true });
    const processManager = {
      start: vi.fn(async () => process),
      stop: vi.fn(async () => undefined)
    };
    const factory = new CodexProtocolApiFactory(processManager as never);

    await expect(
      factory.create({
        chatId: "chat-init-fail",
        backend: createBackendIdentity("codex", "gpt-5-codex"),
        serverCmd: "codex app-server"
      })
    ).rejects.toThrow(/initialize failed/);
  });
});
