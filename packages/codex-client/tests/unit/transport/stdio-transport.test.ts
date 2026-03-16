import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWritable extends EventEmitter {
  readonly written: string[] = [];
  nextError: Error | null = null;

  write(chunk: string, callback?: (error?: Error | null) => void): boolean {
    this.written.push(chunk);
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      callback?.(error);
      return false;
    }
    callback?.(null);
    return true;
  }
}

class FakeReadable extends EventEmitter {
  setEncoding(): void {
    return;
  }
}

class FakeChildProcess extends EventEmitter {
  readonly stdin = new FakeWritable();

  readonly stdout = new FakeReadable();

  exitCode: number | null = null;

  kill = vi.fn(() => true);
}

const spawnMock = vi.fn();

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    spawn: spawnMock
  };
});

describe("stdio-transport", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function createTransport() {
    const child = new FakeChildProcess();
    spawnMock.mockReturnValue(child);
    const { spawnStdioRpcTransport } = await import("../../../src/stdio-transport");
    return {
      child,
      transport: spawnStdioRpcTransport("codex app-server")
    };
  }

  it("parses request response from stdout json line", async () => {
    const { child, transport } = await createTransport();

    const promise = transport.request<{ ok: boolean }>({
      id: "rpc-1",
      method: "thread/start",
      params: { model: "gpt-5-codex" }
    });

    expect(child.stdin.written[0]).toContain("\"id\":\"rpc-1\"");
    child.stdout.emit("data", "{\"id\":\"rpc-1\",\"result\":{\"ok\":true}}\n");

    await expect(promise).resolves.toEqual({
      id: "rpc-1",
      result: { ok: true }
    });
  });

  it("emits notification when payload has no id", async () => {
    const { child, transport } = await createTransport();
    const handler = vi.fn();
    transport.onNotification(handler);

    child.stdout.emit("data", "{\"method\":\"event/msg\",\"params\":{\"type\":\"task_started\"}}\n");

    expect(handler).toHaveBeenCalledWith({
      method: "event/msg",
      params: { type: "task_started" }
    });
  });

  it("rejects timed-out requests", async () => {
    vi.useFakeTimers();
    const { transport } = await createTransport();

    const promise = transport.request(
      {
        id: "rpc-2",
        method: "turn/start",
        params: {}
      },
      10
    );

    const assertion = expect(promise).rejects.toThrow(/timeout/);
    await vi.advanceTimersByTimeAsync(20);
    await assertion;
  });

  it("rejects all pending requests when child process closes", async () => {
    const { child, transport } = await createTransport();

    const requestA = transport.request({ id: "rpc-a", method: "thread/start", params: {} });
    const requestB = transport.request({ id: "rpc-b", method: "turn/start", params: {} });

    child.emit("close", 1, null);

    await expect(requestA).rejects.toThrow(/process closed/);
    await expect(requestB).rejects.toThrow(/process closed/);
  });

  it("[C1-5] rejects all pending requests when child emits error", async () => {
    const { child, transport } = await createTransport();
    const error = new Error("rpc stream broken");
    const pending = transport.request({ id: "rpc-c1-5", method: "thread/start", params: {} });

    child.emit("error", error);

    await expect(pending).rejects.toBe(error);
  });

  it("[C1-6] rejects request when transport has been closed", async () => {
    const { transport } = await createTransport();
    transport.close();

    await expect(transport.request({ id: "rpc-c1-6", method: "thread/start" })).rejects.toThrow(/closed/);
  });

  it("[C1-7] rejects request when stdin.write callback receives error", async () => {
    const { child, transport } = await createTransport();
    child.stdin.nextError = new Error("write failed");

    await expect(transport.request({ id: "rpc-c1-7", method: "thread/start" })).rejects.toThrow(/write failed/);
  });

  it("[C1-8] writes notify payload without id field", async () => {
    const { child, transport } = await createTransport();

    await transport.notify("event/msg", { type: "task_started" });

    const payload = JSON.parse(child.stdin.written[0] ?? "{}") as Record<string, unknown>;
    expect(payload).toEqual({
      method: "event/msg",
      params: { type: "task_started" }
    });
    expect(payload).not.toHaveProperty("id");
  });

  it("[C1-9] rejects notify when transport has been closed", async () => {
    const { transport } = await createTransport();
    transport.close();

    await expect(transport.notify("event/msg", { ok: true })).rejects.toThrow(/closed/);
  });

  it("[C1-11] invokes all registered notification handlers", async () => {
    const { child, transport } = await createTransport();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    transport.onNotification(handlerA);
    transport.onNotification(handlerB);

    child.stdout.emit("data", "{\"method\":\"event/msg\",\"params\":{\"type\":\"task_started\"}}\n");

    expect(handlerA).toHaveBeenCalledTimes(1);
    expect(handlerB).toHaveBeenCalledTimes(1);
  });

  it("[C1-12] kills child process with SIGTERM when close is called", async () => {
    const { child, transport } = await createTransport();

    transport.close();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("[C1-13] rejects pending requests when close is called manually", async () => {
    const { transport } = await createTransport();
    const pending = transport.request({ id: "rpc-c1-13", method: "thread/start", params: {} });

    transport.close();

    await expect(pending).rejects.toThrow(/closed/);
  });

  it("[C1-14] allows repeated close calls without side effects", async () => {
    const { child, transport } = await createTransport();

    expect(() => {
      transport.close();
      transport.close();
    }).not.toThrow();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("[C1-15] parses multiple json lines in a single stdout chunk", async () => {
    const { child, transport } = await createTransport();
    const notificationHandler = vi.fn();
    transport.onNotification(notificationHandler);
    const pending = transport.request<{ ok: boolean }>({
      id: "rpc-c1-15",
      method: "thread/start",
      params: {}
    });

    child.stdout.emit(
      "data",
      `${JSON.stringify({ method: "event/msg", params: { type: "task_started" } })}\n${JSON.stringify({
        id: "rpc-c1-15",
        result: { ok: true }
      })}\n`
    );

    await expect(pending).resolves.toEqual({ id: "rpc-c1-15", result: { ok: true } });
    expect(notificationHandler).toHaveBeenCalledWith({
      method: "event/msg",
      params: { type: "task_started" }
    });
  });

  it("[C1-16] ignores invalid json line and continues processing next messages", async () => {
    const { child, transport } = await createTransport();
    const pending = transport.request<{ ok: boolean }>({
      id: "rpc-c1-16",
      method: "thread/start",
      params: {}
    });

    child.stdout.emit("data", "not-a-json-line\n");
    child.stdout.emit("data", "{\"id\":\"rpc-c1-16\",\"result\":{\"ok\":true}}\n");

    await expect(pending).resolves.toEqual({
      id: "rpc-c1-16",
      result: { ok: true }
    });
  });
});
