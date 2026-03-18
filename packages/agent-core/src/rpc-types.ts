export interface JsonRpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

/** Server-initiated JSON-RPC request (has both id and method, sent by the server) */
export interface ServerRequest {
  id: string | number;
  method: string;
  params: Record<string, unknown>;
}

export interface RpcTransport {
  request<T = unknown>(request: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse<T>>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
  /** Send a JSON-RPC response to a server-initiated request */
  respondToServerRequest?(id: string | number, result: unknown): Promise<void>;
  /** Register a handler for server-initiated requests (e.g. approval requests) */
  onServerRequest?(handler: (request: ServerRequest) => void): void;
}

/** JSON-RPC notification from server (renamed from CodexNotification) */
export interface RpcNotification {
  method: string;
  params: Record<string, unknown>;
}
