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
  BackendCmdResult,
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

// ── Transport factory assembly ──────────────────────────────────────────────
// Exposes a public API so L2 can obtain transport factories without importing
// internal `transports/` paths directly.

import type { AgentApiFactory as _AgentApiFactory } from "./types";
import { AgentProcessManager as _AgentProcessManager } from "./agent-process-manager";
import { CodexProtocolApiFactory as _CodexFactory } from "./transports/codex/codex-api-factory";
import { AcpApiFactory as _AcpFactory } from "./transports/acp/acp-api-factory";

/**
 * Create the default set of transport factories (codex + acp).
 * L2 calls this from `createOrchestratorLayer` so it never imports transport internals.
 */
export function createDefaultTransportFactories(): Record<string, _AgentApiFactory> {
  const processManager = new _AgentProcessManager();
  return {
    codex: new _CodexFactory(processManager),
    acp: new _AcpFactory(),
  };
}
