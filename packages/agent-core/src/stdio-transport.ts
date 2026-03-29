import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";

import type { RpcNotification, JsonRpcRequest, JsonRpcResponse, RpcTransport, ServerRequest } from "./rpc-types";
import { createLogger } from "../../logger/src/index";
import type { BackendRpcCorrelation } from "./rpc-client";

const log = createLogger("stdio-rpc");
const rpcTraceLog = createLogger("backend-rpc");

function preview(value: unknown, maxLength = 500): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= maxLength) {
      return serialized;
    }
    return `${serialized.slice(0, maxLength)}...`;
  } catch {
    return String(value);
  }
}

interface PendingRequest<T = unknown> {
  resolve: (response: JsonRpcResponse<T>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class StdioRpcTransport implements RpcTransport {
  private readonly child: ChildProcessWithoutNullStreams;

  private readonly pending = new Map<string, PendingRequest>();

  private readonly notificationHandlers = new Set<(notification: RpcNotification) => void>();

  private readonly serverRequestHandlers = new Set<(request: ServerRequest) => void>();

  private closed = false;

  /** Preserves original server-request id types (number vs string) for responses */
  private readonly pendingServerRequestIds = new Map<string, string | number>();

  private buffer = "";
  private correlation: BackendRpcCorrelation;

  constructor(child: ChildProcessWithoutNullStreams, correlation: BackendRpcCorrelation = {}) {
    this.child = child;
    this.correlation = { ...correlation };

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    if (this.child.stderr) {
      this.child.stderr.setEncoding("utf8");
      this.child.stderr.on("data", (chunk: string) => {
        log.debug({ ...this.correlation, stderr: chunk.slice(0, 500) }, "process stderr");
      });
    }
    this.child.on("close", (code, signal) => {
      log.info({ code, signal }, "process closed");
      this.rejectAllPending(new Error(`rpc process closed (code=${String(code)}, signal=${String(signal)})`));
      this.closed = true;
    });
    this.child.on("error", (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });
  }

  setLogCorrelation(correlation: Partial<BackendRpcCorrelation>): void {
    this.correlation = { ...this.correlation, ...correlation };
  }

  async request<T = unknown>(request: JsonRpcRequest, timeoutMs = 30_000): Promise<JsonRpcResponse<T>> {
    if (this.closed) {
      throw new Error("rpc transport is closed");
    }

    return new Promise<JsonRpcResponse<T>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id);
        reject(new Error(`rpc request timeout: ${request.method} (${request.id})`));
      }, timeoutMs);

      this.pending.set(request.id, {
        resolve: resolve as PendingRequest["resolve"],
        reject,
        timer
      });

      this.writeJsonLine(request).catch((error) => {
        clearTimeout(timer);
        this.pending.delete(request.id);
        reject(error);
      });
    });
  }

  async notify(method: string, params?: Record<string, unknown>): Promise<void> {
    if (this.closed) {
      throw new Error("rpc transport is closed");
    }
    rpcTraceLog.info({ ...this.correlation, direction: "notify", method, params: preview(params ?? {}) }, "rpc transport notify");
    await this.writeJsonLine({ method, params });
  }

  onNotification(handler: (notification: RpcNotification) => void): void {
    this.notificationHandlers.add(handler);
  }

  onServerRequest(handler: (request: ServerRequest) => void): void {
    this.serverRequestHandlers.add(handler);
  }

  async respondToServerRequest(id: string | number, result: unknown): Promise<void> {
    if (this.closed) {
      throw new Error("rpc transport is closed");
    }
    // Restore the original id type (number vs string) from when the server request arrived
    const originalId = this.pendingServerRequestIds.get(String(id)) ?? id;
    this.pendingServerRequestIds.delete(String(id));
    log.debug({ id: originalId, idType: typeof originalId, result }, "responding to server request");
    await this.writeJsonLine({ jsonrpc: "2.0", id: originalId, result });
  }

  async rejectServerRequest(id: string | number, code: number, message: string): Promise<void> {
    if (this.closed) {
      throw new Error("rpc transport is closed");
    }
    const originalId = this.pendingServerRequestIds.get(String(id)) ?? id;
    this.pendingServerRequestIds.delete(String(id));
    log.warn({ id: originalId, code, message }, "rejecting server request");
    await this.writeJsonLine({ jsonrpc: "2.0", id: originalId, error: { code, message } });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectAllPending(new Error("rpc transport closed"));
    this.child.stdout.removeAllListeners("data");
    this.child.removeAllListeners("close");
    this.child.removeAllListeners("error");
    this.child.kill("SIGTERM");
  }

  getProcess(): ChildProcessWithoutNullStreams {
    return this.child;
  }

  private async writeJsonLine(payload: unknown): Promise<void> {
    const line = `${JSON.stringify(payload)}\n`;
    const preview = line.length > 300 ? line.slice(0, 300) + "..." : line.trimEnd();
    log.debug({ direction: ">>>", preview }, "rpc write");
    await new Promise<void>((resolve, reject) => {
      this.child.stdin.write(line, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newLineIndex = this.buffer.indexOf("\n");
    while (newLineIndex >= 0) {
      const line = this.buffer.slice(0, newLineIndex).trim();
      this.buffer = this.buffer.slice(newLineIndex + 1);
      if (line.length > 0) {
        this.onLine(line);
      }
      newLineIndex = this.buffer.indexOf("\n");
    }
  }

  private onLine(line: string): void {
    const linePreview = line.length > 300 ? line.slice(0, 300) + "..." : line;
    log.debug({ direction: "<<<", preview: linePreview }, "rpc read");
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      log.debug({ line: line.slice(0, 200) }, "rpc non-json line (ignored)");
      return;
    }

    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const message = parsed as { id?: string | number; method?: string; params?: Record<string, unknown> };
    if (message.id !== undefined && message.id !== null) {
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (pending) {
        // Response to our client-initiated request
        clearTimeout(pending.timer);
        this.pending.delete(id);
        rpcTraceLog.info({ ...this.correlation, direction: "incoming_response", requestId: message.id, payload: preview(parsed) }, "rpc transport response");
        pending.resolve(message as JsonRpcResponse);
        return;
      }
      // Server-initiated request (has id + method, not in our pending map)
      if (typeof message.method === "string") {
        log.debug({ id: message.id, idType: typeof message.id, method: message.method }, "server-initiated request received");
        rpcTraceLog.info({ ...this.correlation, direction: "incoming_server_request", requestId: message.id, method: message.method, params: preview(message.params ?? {}) }, "rpc transport server request");
        // Preserve original id type for response matching (Codex uses numeric ids)
        this.pendingServerRequestIds.set(String(message.id), message.id);
        const serverReq: ServerRequest = { id: message.id, method: message.method, params: message.params ?? {} };
        for (const handler of this.serverRequestHandlers) {
          handler(serverReq);
        }
        return;
      }
    }

    if (typeof message.method === "string") {
      rpcTraceLog.info({ ...this.correlation, direction: "incoming_notification", method: message.method, params: preview(message.params ?? {}) }, "rpc transport notification");
      const notification: RpcNotification = {
        method: message.method,
        params: message.params ?? {}
      };
      for (const handler of this.notificationHandlers) {
        handler(notification);
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

export function spawnStdioRpcTransport(command: string, options?: SpawnOptionsWithoutStdio): StdioRpcTransport {
  const child = spawn(command, {
    ...options,
    shell: true,
    stdio: "pipe"
  });
  return new StdioRpcTransport(child);
}
