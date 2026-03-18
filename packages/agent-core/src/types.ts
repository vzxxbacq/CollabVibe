import type { UnifiedAgentEvent } from "./unified-agent-event";
import type { BackendIdentity, TransportType } from "./backend-identity";

export interface McpServerConfig {
  /** Server name/identifier */
  name: string;
  /** Command to launch the MCP server */
  command: string;
  /** Arguments for the command */
  args?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
}

export interface RuntimeConfig {
  /** Canonical backend identity (I2: atomic, required) */
  backend: BackendIdentity;
  cwd?: string;
  /** Project-scoped base branch for merge operations */
  baseBranch?: string;
  sandbox?: string;
  approvalPolicy?: string;
  personality?: string;
  serviceName?: string;
  serverCmd?: string;
  serverPort?: number;
  /** Extra env vars for spawned process (e.g. OPENCODE_CONFIG) */
  env?: Record<string, string>;
  /** Thread name from the active binding — used by pool/factory for keying */
  threadName?: string;
  /** ACP backend session ID (set once at thread creation) */
  backendSessionId?: string;
  /** Callback when ACP assigns a new session ID (for persistence) */
  onBackendSessionIdChanged?: (newSessionId: string) => void;
  /** MCP servers from plugins — passed to ACP session/new */
  mcpServers?: McpServerConfig[];
}

export type TurnInputItem =
  | { type: "text"; text: string }
  | { type: "skill"; name: string; path: string }
  | { type: "file_mention"; path: string }
  | { type: "local_image"; path: string };

export interface AgentApi {
  backendType: "codex" | "acp";
  threadStart(params: RuntimeConfig): Promise<{ thread: { id: string } }>;
  threadResume?(threadId: string, params?: RuntimeConfig): Promise<{ thread: { id: string } }>;
  turnStart(params: {
    threadId: string;
    traceId?: string;
    input: TurnInputItem[];
  }): Promise<{ turn: { id: string } }>;
  /** Switch agent execution mode (plan = read-only analysis, code = full execution). Only ACP/Codex implement this. */
  setMode?(mode: "plan" | "code"): Promise<void>;
  /** Unified approval response — replaces respondExecApproval/respondApplyPatchApproval */
  respondApproval?(params: {
    action: "approve" | "deny" | "approve_always";
    approvalId: string;
    threadId?: string;
    turnId?: string;
    callId?: string;
    approvalType?: "command_exec" | "file_change";
  }): Promise<void>;
  /** Respond to a user input request with answers keyed by question ID */
  respondUserInput?(params: {
    callId: string;
    answers: Record<string, string[]>;
  }): Promise<void>;
  onNotification?(handler: (notification: { method: string; params: Record<string, unknown> } | UnifiedAgentEvent) => void): void;
  turnInterrupt?(threadId: string, turnId: string): Promise<void>;
  threadRollback?(threadId: string, numTurns?: number): Promise<void>;
}

export interface ApprovalAwareAgentApi extends AgentApi {
  respondApproval(params: {
    action: "approve" | "deny" | "approve_always";
    approvalId: string;
    threadId?: string;
    turnId?: string;
    callId?: string;
    approvalType?: "command_exec" | "file_change";
  }): Promise<void>;
}

export interface RuntimeConfigProvider {
  getProjectRuntimeConfig(projectId: string, userId?: string): Promise<RuntimeConfig>;
}

export interface AgentApiPool {
  /** Create a new API from a pre-built RuntimeConfig. Caches by project-thread key (derived from bound chatId + threadName). */
  createWithConfig(chatId: string, threadName: string, config: RuntimeConfig): Promise<AgentApi>;
  /** Pure cache lookup — returns null if no API exists for this project-thread key. */
  get(chatId: string, threadName: string): AgentApi | null;
  releaseThread(chatId: string, threadName: string): Promise<void>;
  /** Release all pool entries for a given project-bound chatId (kills subprocesses). */
  releaseByPrefix?(chatId: string): Promise<void>;
  releaseAll?(): Promise<void>;
  healthCheck(chatId: string, threadName?: string): Promise<{ alive: boolean; threadCount: number }>;
}

export interface AgentApiFactory {
  create(config: RuntimeConfig & { chatId: string; userId?: string; threadName: string }): Promise<AgentApi>;
  dispose?(api: AgentApi): Promise<void>;
  healthCheck?(api: AgentApi): Promise<{ alive: boolean; threadCount: number }>;
}
