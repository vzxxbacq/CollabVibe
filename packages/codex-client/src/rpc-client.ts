import { CodexApiError, CodexClientStateError } from "./errors";
import type { InitializeParams, JsonRpcRequest, RpcTransport } from "./types";

function isValidInitializeParams(params: InitializeParams): boolean {
  const capabilities = params.capabilities;
  const info = params.clientInfo;
  const hasValidCapabilities =
    capabilities === undefined ||
    (typeof capabilities === "object" &&
      capabilities !== null &&
      (capabilities.experimentalApi === undefined || typeof capabilities.experimentalApi === "boolean") &&
      (capabilities.optOutNotificationMethods === undefined ||
        (Array.isArray(capabilities.optOutNotificationMethods) &&
          capabilities.optOutNotificationMethods.every((value) => typeof value === "string"))));

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

  private requestCounter = 0;

  private initialized = false;

  constructor(transport: RpcTransport) {
    this.transport = transport;
  }

  nextRequestId(): string {
    this.requestCounter += 1;
    return `rpc-${this.requestCounter}`;
  }

  async initialize(params: InitializeParams): Promise<void> {
    if (this.initialized) {
      throw new CodexClientStateError("already initialized");
    }

    if (!isValidInitializeParams(params)) {
      throw new CodexClientStateError(
        "initialize requires clientInfo.name/title/version and valid optional capabilities"
      );
    }

    const request: JsonRpcRequest = {
      id: this.nextRequestId(),
      method: "initialize",
      params: params as unknown as Record<string, unknown>
    };
    const response = await this.transport.request(request);
    if (response.error) {
      throw new CodexApiError(response.error.code, response.error.message);
    }
    await this.transport.notify("initialized", {});
    this.initialized = true;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
    if (!this.initialized && method !== "initialize") {
      throw new CodexClientStateError("client must initialize before calling api methods");
    }

    const response = await this.transport.request<T>(
      {
        id: this.nextRequestId(),
        method,
        params
      },
      timeoutMs
    );

    if (response.error) {
      throw new CodexApiError(response.error.code, response.error.message);
    }

    if (response.result === undefined) {
      throw new CodexApiError(-32000, "server returned empty result");
    }

    return response.result as T;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}
