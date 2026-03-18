// Backend identity
export type { BackendId, TransportType, BackendIdentity } from "./backend-identity";
export { transportFor, isBackendId, createBackendIdentity } from "./backend-identity";

// Backend config types (cross-platform contract)
export type {
  UnifiedProviderInput,
  UnifiedProfileInput,
  StoredProvider,
  StoredProfile,
  BackendConfigData,
  CodexServerCmdResult
} from "./backend-config-types";

// Constants
export { MAIN_THREAD_NAME, SYSTEM_USER_ID } from "./constants";

// Types
export type {
  RuntimeConfig,
  AgentApi,
  ApprovalAwareAgentApi,
  AgentApiPool,
  AgentApiFactory,
  RuntimeConfigProvider
} from "./types";

// Unified event types
export type { UnifiedAgentEvent, UnifiedAgentTool } from "./unified-agent-event";

// RPC types
export type {
  JsonRpcRequest,
  JsonRpcNotification,
  JsonRpcResponse,
  RpcTransport,
  RpcNotification
} from "./rpc-types";

// RPC client
export { JsonRpcClient, RpcApiError, RpcClientStateError } from "./rpc-client";
export type { InitializeParams } from "./rpc-client";

// Transport
export { StdioRpcTransport, spawnStdioRpcTransport } from "./stdio-transport";

// Process management
export { AgentProcessManager } from "./agent-process-manager";
export type { ManagedProcess, ProcessSpawnConfig } from "./agent-process-manager";

// Codex protocol event type (re-exported so channel-core doesn't depend on codex-client directly)
export type { EventMsg } from "./transports/codex/generated/EventMsg";

// Transport implementations (merged from codex-client + acp-client)
export { CodexProtocolApiFactory } from "./transports/codex/codex-api-factory";
export { AcpApiFactory } from "./transports/acp/acp-api-factory";
