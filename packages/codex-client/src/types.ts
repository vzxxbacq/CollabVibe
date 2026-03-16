import type { ClientInfo as GeneratedClientInfo } from "./generated/ClientInfo";
import type { InitializeCapabilities as GeneratedInitializeCapabilities } from "./generated/InitializeCapabilities";
import type { InitializeParams as GeneratedInitializeParams } from "./generated/InitializeParams";

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

export interface RpcTransport {
  request<T = unknown>(request: JsonRpcRequest, timeoutMs?: number): Promise<JsonRpcResponse<T>>;
  notify(method: string, params?: Record<string, unknown>): Promise<void>;
}

export type ClientInfo = GeneratedClientInfo;
export type InitializeCapabilities = GeneratedInitializeCapabilities;
export type StrictInitializeParams = GeneratedInitializeParams;
export type InitializeParams = Omit<GeneratedInitializeParams, "capabilities"> & {
  capabilities?: Partial<GeneratedInitializeCapabilities> | null;
};

export interface ThreadInfo {
  id: string;
  preview?: string;
  ephemeral?: boolean;
  modelProvider?: string;
  createdAt?: number;
  name?: string | null;
}

export interface ThreadResult {
  thread: ThreadInfo;
}

export type SandboxPolicy = "workspaceWrite" | "readOnly" | "dangerFullAccess" | (string & {});

export type TurnInputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string }
  | { type: "skill"; name: string; path: string };

export interface TurnInfo {
  id: string;
  status: "inProgress" | "completed" | "interrupted" | "failed";
  items: unknown[];
  error: {
    message: string;
    codexErrorInfo?: string;
    additionalDetails?: string;
  } | null;
}

export interface TurnResult {
  turn: TurnInfo;
}

export interface ThreadStartParams {
  model: string;
  cwd?: string;
  sandbox?: string;
  approvalPolicy?: string;
  personality?: string;
  serviceName?: string;
}

export interface TurnStartParams {
  threadId: string;
  input: TurnInputItem[];
  cwd?: string;
  model?: string;
  effort?: string;
  personality?: string;
  summary?: string;
  approvalPolicy?: string;
  sandboxPolicy?: SandboxPolicy;
  outputSchema?: Record<string, unknown>;
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface ExecApprovalDecisionParams {
  requestId: string;
  threadId: string;
  turnId: string;
  callId: string;
  decision: "accept" | "decline" | "approve_always";
}

export interface ApplyPatchApprovalDecisionParams {
  requestId: string;
  threadId: string;
  turnId: string;
  callId: string;
  decision: "accept" | "decline" | "approve_always";
}

export interface TurnStatusUpdate {
  threadId: string;
  turnId: string;
  status: "inProgress" | "completed" | "interrupted" | "failed";
}

/** JSON-RPC notification from server */
export interface CodexNotification {
  method: string;
  params: Record<string, unknown>;
}

/** Parsed item from params.item in item/* notifications */
export interface CodexItem {
  id: string;
  type: string;
  [key: string]: unknown;
}
