import type { JsonRpcRequest, RpcTransport } from "./rpc-types";
import { createLogger } from "../../channel-core/src/index";

const log = createLogger("backend-rpc");

export interface BackendRpcCorrelation {
  chatId?: string;
  threadName?: string;
  turnId?: string;
  turnMode?: "plan" | "code";
}

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

export class RpcApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "RpcApiError";
    this.code = code;
  }
}

export class RpcClientStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcClientStateError";
  }
}

export interface InitializeParams {
  clientInfo: { name: string; title: string; version: string };
  capabilities?: Record<string, unknown> | null;
  [key: string]: unknown;
}

function isValidInitializeParams(params: InitializeParams): boolean {
  const capabilities = params.capabilities;
  const info = params.clientInfo;
  const hasValidCapabilities =
    capabilities === undefined ||
    capabilities === null ||
    (typeof capabilities === "object" &&
      capabilities !== null);

  return hasValidCapabilities && (
    typeof info?.name === "string" &&
    info.name.length > 0 &&
    typeof info?.title === "string" &&
    info.title.length > 0 &&
    typeof info?.version === "string" &&
    info.version.length > 0
  );
}

export class JsonRpcClient {
  private readonly transport: RpcTransport;
  private correlation: BackendRpcCorrelation;

  private requestCounter = 0;

  private initialized = false;

  constructor(transport: RpcTransport, correlation: BackendRpcCorrelation = {}) {
    this.transport = transport;
    this.correlation = { ...correlation };
  }

  setLogCorrelation(correlation: Partial<BackendRpcCorrelation>): void {
    this.correlation = { ...this.correlation, ...correlation };
  }

  nextRequestId(): string {
    this.requestCounter += 1;
    return `rpc-${this.requestCounter}`;
  }

  async initialize(params: InitializeParams): Promise<void> {
    if (this.initialized) {
      throw new RpcClientStateError("already initialized");
    }

    if (!isValidInitializeParams(params)) {
      throw new RpcClientStateError(
        "initialize requires clientInfo.name/title/version and valid optional capabilities"
      );
    }

    const request: JsonRpcRequest = {
      id: this.nextRequestId(),
      method: "initialize",
      params: params as unknown as Record<string, unknown>
    };
    log.info({ ...this.correlation, direction: "call", method: request.method, requestId: request.id, params: preview(request.params) }, "rpc client request");
    const response = await this.transport.request(request);
    if (response.error) {
      log.warn({ ...this.correlation, direction: "response", method: request.method, requestId: request.id, error: response.error }, "rpc client error");
      throw new RpcApiError(response.error.code, response.error.message);
    }
    log.info({ ...this.correlation, direction: "response", method: request.method, requestId: request.id, result: preview(response.result) }, "rpc client response");
    await this.transport.notify("initialized", {});
    this.initialized = true;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    if (!this.initialized && method !== "initialize") {
      throw new RpcClientStateError("client must initialize before calling api methods");
    }

    const requestId = this.nextRequestId();
    log.info({ ...this.correlation, direction: "call", method, requestId, params: preview(params), timeoutMs }, "rpc client request");
    const response = await this.transport.request<T>(
      {
        id: requestId,
        method,
        params
      },
      timeoutMs
    );

    if (response.error) {
      log.warn({ ...this.correlation, direction: "response", method, requestId, error: response.error }, "rpc client error");
      throw new RpcApiError(response.error.code, response.error.message);
    }

    if (response.result === undefined) {
      log.warn({ ...this.correlation, direction: "response", method, requestId, result: undefined }, "rpc client empty result");
      throw new RpcApiError(-32000, "server returned empty result");
    }

    log.info({ ...this.correlation, direction: "response", method, requestId, result: preview(response.result) }, "rpc client response");

    return response.result as T;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
